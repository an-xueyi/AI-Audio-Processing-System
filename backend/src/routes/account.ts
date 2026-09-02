/* Manage an authenticated account after registration or login has completed. */
import { Router } from "express";
import { z } from "zod";
import {
  changeUserPassword,
  deleteUserAccount,
  findPasswordHashForUser,
} from "../auth/accountLifecycleService.js";
import {
  clearAuthenticationCookie,
  readAuthenticationToken,
} from "../auth/authCookie.js";
import { hashAuthenticationToken } from "../auth/authToken.js";
import { hashPassword, verifyPassword } from "../auth/password.js";
import {
  listActiveUserSessions,
  revokeOtherUserSessions,
} from "../auth/sessionManagementService.js";
import { passwordSchema } from "../auth/validation.js";
import { authenticationRateLimit } from "../middleware/rateLimits.js";
import { logger } from "../observability/logger.js";

const router = Router();

const changePasswordSchema = z
  .object({
    currentPassword: passwordSchema,
    newPassword: passwordSchema,
  })
  .strict()
  .refine((passwords) => passwords.currentPassword !== passwords.newPassword, {
    message: "The new password must be different from the current password",
    path: ["newPassword"],
  });

const deleteAccountSchema = z
  .object({
    password: passwordSchema,
  })
  .strict();

// Every route in this router requires a permanent user account. A valid anonymous
// browser session may still use uploads/jobs, but it cannot manage an account.
router.use((req, res, next) => {
  if (!req.authenticatedUser) {
    return res.status(401).json({ error: "A signed-in account is required" });
  }

  next();
});

function readCurrentTokenHash(cookieHeader: string | undefined): string | null {
  const token = readAuthenticationToken(cookieHeader);
  return token ? hashAuthenticationToken(token) : null;
}

router.get("/sessions", async (req, res) => {
  const tokenHash = readCurrentTokenHash(req.headers.cookie);

  if (!tokenHash || !req.authenticatedUser) {
    return res.status(401).json({ error: "A current login session is required" });
  }

  const sessions = await listActiveUserSessions(
    req.authenticatedUser.id,
    tokenHash,
  );

  res.json({ sessions });
});

router.post("/sessions/revoke-others", async (req, res) => {
  const tokenHash = readCurrentTokenHash(req.headers.cookie);

  if (!tokenHash || !req.authenticatedUser) {
    return res.status(401).json({ error: "A current login session is required" });
  }

  const revokedCount = await revokeOtherUserSessions(
    req.authenticatedUser.id,
    tokenHash,
  );
  const sessions = await listActiveUserSessions(
    req.authenticatedUser.id,
    tokenHash,
  );

  logger.info("other_account_sessions_revoked", {
    userId: req.authenticatedUser.id,
    revokedCount,
  });
  res.json({ revokedCount, sessions });
});

router.post("/password", authenticationRateLimit, async (req, res) => {
  const parsedRequest = changePasswordSchema.safeParse(req.body);

  if (!parsedRequest.success) {
    return res.status(400).json({
      error:
        parsedRequest.error.issues[0]?.message ||
        "Invalid password change request",
    });
  }

  const tokenHash = readCurrentTokenHash(req.headers.cookie);
  const user = req.authenticatedUser;

  if (!tokenHash || !user) {
    return res.status(401).json({ error: "A current login session is required" });
  }

  const storedPasswordHash = await findPasswordHashForUser(user.id);
  const currentPasswordMatches = storedPasswordHash
    ? await verifyPassword(
        parsedRequest.data.currentPassword,
        storedPasswordHash,
      )
    : false;

  if (!currentPasswordMatches) {
    return res.status(401).json({ error: "The current password is incorrect" });
  }

  const newPasswordHash = await hashPassword(parsedRequest.data.newPassword);
  await changeUserPassword(user.id, newPasswordHash, tokenHash);
  logger.info("account_password_changed", { userId: user.id });
  res.status(204).send();
});

router.post("/account", authenticationRateLimit, async (req, res) => {
  const parsedRequest = deleteAccountSchema.safeParse(req.body);

  if (!parsedRequest.success) {
    return res.status(400).json({
      error:
        parsedRequest.error.issues[0]?.message ||
        "Invalid account deletion request",
    });
  }

  const user = req.authenticatedUser;

  if (!user) {
    return res.status(401).json({ error: "A signed-in account is required" });
  }

  const storedPasswordHash = await findPasswordHashForUser(user.id);
  const passwordMatches = storedPasswordHash
    ? await verifyPassword(parsedRequest.data.password, storedPasswordHash)
    : false;

  if (!passwordMatches) {
    return res.status(401).json({ error: "The password is incorrect" });
  }

  await deleteUserAccount(user.id);
  clearAuthenticationCookie(res);
  logger.info("account_deleted", { userId: user.id });
  res.status(204).send();
});

export default router;
