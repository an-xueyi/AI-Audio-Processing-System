/* Register accounts, start and end login sessions, and report current identity. */
import { Router } from "express";
import {
  createUserSession,
  findUserForLogin,
  isUsernameConflict,
  registerUser,
  revokeUserSession,
} from "../auth/accountService.js";
import {
  clearAuthenticationCookie,
  readAuthenticationToken,
  setAuthenticationCookie,
} from "../auth/authCookie.js";
import {
  createAuthenticationToken,
  hashAuthenticationToken,
} from "../auth/authToken.js";
import { hashPassword, verifyPassword } from "../auth/password.js";
import { sessionMaxAgeSeconds } from "../auth/session.js";
import { credentialsSchema } from "../auth/validation.js";
import { authenticationRateLimit } from "../middleware/rateLimits.js";
import { logger } from "../observability/logger.js";
import accountRouter from "./account.js";

const router = Router();

function parseCredentials(body: unknown) {
  // safeParse reports expected user input errors without throwing an exception.
  return credentialsSchema.safeParse(body);
}

function createSessionValues(reqCookieHeader: string | undefined) {
  // Only the unhashed random value goes to the browser. The service receives its
  // SHA-256 fingerprint and an absolute server-generated expiration time.
  const token = createAuthenticationToken();
  const existingToken = readAuthenticationToken(reqCookieHeader);

  return {
    token,
    tokenHash: hashAuthenticationToken(token),
    expiresAt: new Date(Date.now() + sessionMaxAgeSeconds * 1000),
    replacedTokenHash: existingToken
      ? hashAuthenticationToken(existingToken)
      : undefined,
  };
}

router.get("/me", (req, res) => {
  // requirePrincipal has already resolved this field from server-verified cookies.
  if (!req.authenticatedUser) {
    return res.json({ authenticated: false, user: null });
  }

  res.json({ authenticated: true, user: req.authenticatedUser });
});

router.post("/register", authenticationRateLimit, async (req, res) => {
  if (req.authenticatedUser) {
    return res.status(409).json({ error: "You are already signed in" });
  }

  const parsedCredentials = parseCredentials(req.body);

  if (!parsedCredentials.success) {
    return res.status(400).json({
      error:
        parsedCredentials.error.issues[0]?.message ||
        "Invalid registration request",
    });
  }

  const { username, password } = parsedCredentials.data;

  // Password hashing happens before the database insert. The original password
  // remains only in this request's memory and is never sent to a log statement.
  const passwordHash = await hashPassword(password);
  const session = createSessionValues(req.headers.cookie);

  try {
    const user = await registerUser(username, passwordHash, {
      anonymousOwnerId: req.anonymousOwnerId,
      expiresAt: session.expiresAt,
      tokenHash: session.tokenHash,
      ...(session.replacedTokenHash
        ? { replacedTokenHash: session.replacedTokenHash }
        : {}),
    });

    setAuthenticationCookie(res, session.token);
    logger.info("account_registered", { userId: user.id });
    res.status(201).json({ authenticated: true, user });
  } catch (error) {
    if (isUsernameConflict(error)) {
      return res.status(409).json({ error: "This username is unavailable" });
    }

    throw error;
  }
});

router.post("/login", authenticationRateLimit, async (req, res) => {
  const parsedCredentials = parseCredentials(req.body);

  if (!parsedCredentials.success) {
    return res.status(400).json({
      error:
        parsedCredentials.error.issues[0]?.message || "Invalid login request",
    });
  }

  const { username, password } = parsedCredentials.data;
  const user = await findUserForLogin(username);

  /*
   * A missing username still performs one expensive scrypt operation. This makes
   * response timing less useful for discovering which account names exist.
   * The generated hash is discarded and never represents a real account.
   */
  const passwordMatches = user
    ? await verifyPassword(password, user.password_hash)
    : (await hashPassword(password), false);

  if (!user || !passwordMatches) {
    // Use one message for both a wrong username and a wrong password.
    return res.status(401).json({ error: "Invalid username or password" });
  }

  const session = createSessionValues(req.headers.cookie);
  await createUserSession(user.id, {
    anonymousOwnerId: req.anonymousOwnerId,
    expiresAt: session.expiresAt,
    tokenHash: session.tokenHash,
    ...(session.replacedTokenHash
      ? { replacedTokenHash: session.replacedTokenHash }
      : {}),
  });

  setAuthenticationCookie(res, session.token);
  logger.info("account_login_succeeded", { userId: user.id });
  res.json({
    authenticated: true,
    user: { id: user.id, username: user.username },
  });
});

router.post("/logout", async (req, res) => {
  const token = readAuthenticationToken(req.headers.cookie);

  if (token) {
    // Revoking the server-side row means a copied old cookie also stops working.
    await revokeUserSession(hashAuthenticationToken(token));
  }

  clearAuthenticationCookie(res);
  logger.info("account_logout_succeeded", {
    userId: req.authenticatedUser?.id ?? null,
  });
  // 204 means the operation succeeded and intentionally has no JSON body.
  res.status(204).send();
});

// Account settings share the /api/auth prefix and the same principal middleware.
router.use(accountRouter);

export default router;
