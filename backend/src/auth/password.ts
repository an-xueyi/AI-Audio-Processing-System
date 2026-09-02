/* Hash and verify account passwords without ever storing reversible passwords. */
import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";

/*
 * OWASP lists several equivalent minimum scrypt configurations. This project
 * uses the 32 MiB option so local Docker development remains practical while
 * each password guess still performs deliberately expensive, memory-hard work.
 *
 * N controls CPU and memory cost, r controls the block size, and p controls how
 * many independent calculations are performed. These values are saved beside
 * each hash so a future configuration can still verify older passwords.
 */
const scryptCost = 2 ** 15;
const scryptBlockSize = 8;
const scryptParallelization = 3;

// A 16-byte random salt ensures equal passwords do not produce equal hashes.
const saltLengthBytes = 16;

// Derive 64 bytes so password comparisons have a large fixed-length value.
const derivedKeyLengthBytes = 64;

// Node rejects scrypt work above maxmem. Sixty-four MiB leaves overhead above
// this configuration's approximate 32 MiB working-memory requirement.
const scryptMaxMemoryBytes = 64 * 1024 * 1024;

type ScryptParameters = {
  cost: number;
  blockSize: number;
  parallelization: number;
};

function derivePasswordKey(
  password: string,
  salt: Buffer,
  parameters: ScryptParameters,
): Promise<Buffer> {
  // Wrap Node's callback API in a Promise so route code can use async/await and
  // avoid blocking the JavaScript event loop with the synchronous scrypt API.
  return new Promise((resolve, reject) => {
    scrypt(
      password,
      salt,
      derivedKeyLengthBytes,
      {
        N: parameters.cost,
        r: parameters.blockSize,
        p: parameters.parallelization,
        maxmem: scryptMaxMemoryBytes,
      },
      (error, derivedKey) => {
        if (error) {
          reject(error);
          return;
        }

        resolve(derivedKey);
      },
    );
  });
}

export async function hashPassword(password: string): Promise<string> {
  // randomBytes uses the operating system's cryptographically secure generator.
  const salt = randomBytes(saltLengthBytes);
  const derivedKey = await derivePasswordKey(password, salt, {
    cost: scryptCost,
    blockSize: scryptBlockSize,
    parallelization: scryptParallelization,
  });

  /*
   * The database needs the algorithm, work settings, salt, and derived bytes to
   * verify a later login. Dollar signs delimit the fields, while base64url turns
   * binary bytes into compact text that is safe to store. None of these fields
   * reveals the original password.
   */
  return [
    "scrypt",
    scryptCost,
    scryptBlockSize,
    scryptParallelization,
    salt.toString("base64url"),
    derivedKey.toString("base64url"),
  ].join("$");
}

export async function verifyPassword(
  suppliedPassword: string,
  storedPasswordHash: string,
): Promise<boolean> {
  // Split the self-describing stored format back into its six components.
  const [algorithm, costText, blockSizeText, parallelizationText, saltText, keyText] =
    storedPasswordHash.split("$");

  // A malformed or unsupported hash must fail closed rather than causing login.
  if (
    algorithm !== "scrypt" ||
    !costText ||
    !blockSizeText ||
    !parallelizationText ||
    !saltText ||
    !keyText
  ) {
    return false;
  }

  const parameters = {
    cost: Number(costText),
    blockSize: Number(blockSizeText),
    parallelization: Number(parallelizationText),
  };

  // All scrypt settings must be positive safe integers before they reach crypto.
  if (
    !Number.isSafeInteger(parameters.cost) ||
    !Number.isSafeInteger(parameters.blockSize) ||
    !Number.isSafeInteger(parameters.parallelization) ||
    parameters.cost <= 1 ||
    parameters.blockSize <= 0 ||
    parameters.parallelization <= 0
  ) {
    return false;
  }

  try {
    const expectedKey = Buffer.from(keyText, "base64url");
    const suppliedKey = await derivePasswordKey(
      suppliedPassword,
      Buffer.from(saltText, "base64url"),
      parameters,
    );

    // timingSafeEqual avoids revealing how many bytes matched through response
    // timing. It requires equal lengths, so check that condition first.
    return (
      expectedKey.length === suppliedKey.length &&
      timingSafeEqual(expectedKey, suppliedKey)
    );
  } catch {
    // Invalid encoded bytes or unreasonable legacy settings are treated exactly
    // like an incorrect password and do not expose internal crypto errors.
    return false;
  }
}
