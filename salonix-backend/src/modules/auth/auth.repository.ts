import { db } from '../../config/database.js';
import { ApiError } from '../../shared/errors/ApiError.js';
import type { AccountType, AuthenticatedUser, User } from './auth.types';

const userFields = `
  id,
  account_type,
  email,
  password_hash,
  full_name,
  phone_number,
  preferred_language,
  status,
  email_verified_at,
  phone_verified_at,
  created_at,
  updated_at,
  EXISTS (
    SELECT 1
    FROM platform_super_admins
    WHERE platform_super_admins.account_id = accounts.id
      AND accounts.account_type = 'ADMIN'
  ) AS is_super_admin
`;

const updateColumns: Partial<Record<keyof User, string>> = {
  full_name: 'full_name',
  preferred_language: 'preferred_language',
};

function isUserUpdateKey(key: string): key is keyof User {
  return Object.prototype.hasOwnProperty.call(updateColumns, key);
}

export class UserRepository {
  async loginWithGoogle(input: {
    accountType: 'CUSTOMER' | 'SALON';
    subject: string;
    email: string;
    fullName: string;
    phoneNumber?: string;
    preferredLanguage: string;
    passwordHash: string;
  }): Promise<{ user: User; phoneVerificationRequired: boolean } | null> {
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      const linkedIdentity = await client.query<{ accountId: string; accountType: string }>(
        `SELECT identity.account_id AS "accountId",
                account.account_type AS "accountType"
         FROM account_provider_identities AS identity
         JOIN accounts AS account ON account.id = identity.account_id
         WHERE identity.provider = 'GOOGLE' AND identity.provider_subject = $1
           AND account.deleted_at IS NULL
         FOR UPDATE OF account`,
        [input.subject]
      );

      let accountId = linkedIdentity.rows[0]?.accountId;
      if (linkedIdentity.rows[0] && linkedIdentity.rows[0].accountType !== input.accountType) {
        throw new ApiError(403, 'Choose the account type linked to this Google account');
      }

      if (!accountId) {
        const existingAccount = await client.query<{
          id: string;
          status: string;
          emailVerifiedAt: Date | null;
        }>(
          `SELECT id, status, email_verified_at AS "emailVerifiedAt"
           FROM accounts
           WHERE email = $1 AND account_type = $2 AND deleted_at IS NULL
           FOR UPDATE`,
          [input.email, input.accountType]
        );

        if (existingAccount.rows[0]) {
          const existing = existingAccount.rows[0];
          if (!existing.emailVerifiedAt) {
            throw new ApiError(
              409,
              'Sign in to the existing account and verify its email before linking Google'
            );
          }
          if (!['ACTIVE', 'PENDING'].includes(existing.status)) {
            throw new ApiError(403, 'This account cannot sign in');
          }
          accountId = existing.id;
        } else {
          if (!input.phoneNumber) {
            await client.query('COMMIT');
            return null;
          }
          const created = await client.query<{ id: string }>(
            `INSERT INTO accounts (
                account_type, email, password_hash, full_name, phone_number,
                preferred_language, status, email_verified_at
             ) VALUES ($1, $2, $3, $4, $5, $6, 'PENDING', CURRENT_TIMESTAMP)
             RETURNING id`,
            [
              input.accountType, input.email, input.passwordHash, input.fullName,
              input.phoneNumber, input.preferredLanguage,
            ]
          );
          accountId = created.rows[0].id;
          if (input.accountType === 'CUSTOMER') {
            await client.query(
              'INSERT INTO customer_profiles (account_id) VALUES ($1)',
              [accountId]
            );
          }
        }

        await client.query(
          `INSERT INTO account_provider_identities (
              account_id, provider, provider_subject, provider_email
           ) VALUES ($1, 'GOOGLE', $2, $3)`,
          [accountId, input.subject, input.email]
        );
      }

      const accountResult = await client.query<User>(
        `SELECT ${userFields}
         FROM accounts
         WHERE id = $1 AND deleted_at IS NULL`,
        [accountId]
      );
      const user = accountResult.rows[0];
      if (!user || !['ACTIVE', 'PENDING'].includes(user.status)) {
        throw new ApiError(403, 'This account cannot sign in');
      }
      await client.query('COMMIT');
      return {
        user,
        phoneVerificationRequired: user.status === 'PENDING' && !user.phone_verified_at,
      };
    } catch (error) {
      await client.query('ROLLBACK');
      if (typeof error === 'object' && error !== null && 'code' in error
          && error.code === '23505') {
        throw new ApiError(409, 'Google account or contact details are already linked');
      }
      throw error;
    } finally {
      client.release();
    }
  }

  async findByEmail(email: string, accountType: AccountType): Promise<User | null> {
    const result = await db.query(
      `SELECT ${userFields}
       FROM accounts
       WHERE email = $1 AND account_type = $2 AND deleted_at IS NULL`,
      [email.trim().toLowerCase(), accountType]
    );
    return result.rows[0] || null;
  }

  async findByPhone(phoneNumber: string, accountType: AccountType): Promise<User | null> {
    const result = await db.query(
      `SELECT ${userFields}
       FROM accounts
       WHERE phone_number = $1 AND account_type = $2 AND deleted_at IS NULL`,
      [phoneNumber, accountType]
    );
    return result.rows[0] ?? null;
  }

  async findByIdentifier(identifier: string, accountType: AccountType): Promise<User | null> {
    return identifier.startsWith('+')
      ? this.findByPhone(identifier, accountType)
      : this.findByEmail(identifier, accountType);
  }

  async findById(id: string): Promise<User | null> {
    const result = await db.query(
      `SELECT ${userFields} FROM accounts WHERE id = $1 AND deleted_at IS NULL`,
      [id]
    );
    return result.rows[0] || null;
  }

  async createPending(userData: {
    accountType: AccountType;
    email?: string;
    passwordHash: string;
    fullName: string;
    phoneNumber: string;
    preferredLanguage: string;
  }): Promise<User> {
    const query = `
      INSERT INTO accounts (
        account_type, email, password_hash, full_name, phone_number, preferred_language, status
      )
      VALUES ($1, $2, $3, $4, $5, $6, 'PENDING')
      RETURNING id;
    `;

    const client = await db.connect();
    try {
      await client.query('BEGIN');
      const result = await client.query(query, [
        userData.accountType,
        userData.email ?? null,
        userData.passwordHash,
        userData.fullName,
        userData.phoneNumber,
        userData.preferredLanguage,
      ]);
      if (userData.accountType === 'CUSTOMER') {
        await client.query(
          'INSERT INTO customer_profiles (account_id) VALUES ($1)',
          [result.rows[0].id]
        );
      }
      await client.query('COMMIT');
      const user = await this.findById(result.rows[0].id);
      if (!user) throw new ApiError(500, 'New account could not be loaded');
      return user;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async markPhoneVerified(accountId: string, phoneNumber: string): Promise<void> {
    const result = await db.query(
      `UPDATE accounts
       SET phone_verified_at = COALESCE(phone_verified_at, CURRENT_TIMESTAMP),
           status = CASE WHEN status = 'PENDING' THEN 'ACTIVE' ELSE status END,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $1 AND phone_number = $2
         AND status IN ('PENDING', 'ACTIVE')
         AND deleted_at IS NULL`,
      [accountId, phoneNumber]
    );
    if (!result.rowCount) throw new ApiError(403, 'This account cannot be activated');
  }

  async setEmail(accountId: string, email: string): Promise<boolean> {
    const result = await db.query(
      `UPDATE accounts
       SET email = $2,
           email_verified_at = CASE WHEN email = $2 THEN email_verified_at ELSE NULL END,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $1 AND status = 'ACTIVE' AND deleted_at IS NULL
       RETURNING email_verified_at`,
      [accountId, email]
    );
    if (!result.rowCount) throw new ApiError(404, 'Active account not found');
    return result.rows[0].email_verified_at !== null;
  }

  async markEmailVerified(accountId: string, email: string): Promise<void> {
    const result = await db.query(
      `UPDATE accounts
       SET email_verified_at = COALESCE(email_verified_at, CURRENT_TIMESTAMP),
           status = CASE WHEN status = 'PENDING' THEN 'ACTIVE' ELSE status END,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $1 AND email = $2
         AND status IN ('PENDING', 'ACTIVE')
         AND deleted_at IS NULL`,
      [accountId, email]
    );
    if (!result.rowCount) throw new ApiError(403, 'This email cannot be verified');
  }

  async setPhone(accountId: string, phoneNumber: string): Promise<boolean> {
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      const result = await client.query(
        `UPDATE accounts
         SET phone_verified_at = CASE
               WHEN phone_number = $2 THEN phone_verified_at
               ELSE NULL
             END,
             status = CASE
               WHEN phone_number = $2 THEN status
               WHEN email_verified_at IS NOT NULL THEN 'ACTIVE'
               ELSE 'PENDING'
             END,
             phone_number = $2,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $1 AND status = 'ACTIVE' AND deleted_at IS NULL
         RETURNING phone_verified_at`,
        [accountId, phoneNumber]
      );
      if (!result.rowCount) throw new ApiError(404, 'Active account not found');
      const phoneVerified = result.rows[0].phone_verified_at !== null;

      if (!phoneVerified) {
        await client.query(
          `UPDATE account_sessions
           SET revoked_at = CURRENT_TIMESTAMP
           WHERE account_id = $1 AND revoked_at IS NULL`,
          [accountId]
        );
      }
      await client.query('COMMIT');
      return phoneVerified;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async setPasswordAndRevokeSessions(accountId: string, passwordHash: string): Promise<void> {
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      const result = await client.query(
        `UPDATE accounts
         SET password_hash = $2, updated_at = CURRENT_TIMESTAMP
         WHERE id = $1 AND status = 'ACTIVE' AND deleted_at IS NULL`,
        [accountId, passwordHash]
      );
      if (!result.rowCount) throw new ApiError(403, 'This account cannot reset its password');
      await client.query(
        `UPDATE account_sessions
         SET revoked_at = CURRENT_TIMESTAMP
         WHERE account_id = $1 AND revoked_at IS NULL`,
        [accountId]
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async createSession(input: {
    sessionId: string;
    accountId: string;
    accessTokenHash: string;
    sessionExpiresAt: Date;
    refreshTokenHash: string;
    refreshExpiresAt: Date;
  }): Promise<void> {
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO account_sessions (id, account_id, token_hash, expires_at)
         VALUES ($1, $2, $3, $4)`,
        [input.sessionId, input.accountId, input.accessTokenHash, input.sessionExpiresAt]
      );
      await client.query(
        `INSERT INTO account_session_refresh_tokens (session_id, token_hash, expires_at)
         VALUES ($1, $2, $3)`,
        [input.sessionId, input.refreshTokenHash, input.refreshExpiresAt]
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async findRefreshSession(
    sessionId: string,
    refreshTokenHash: string
  ): Promise<{ accountId: string; sessionExpiresAt: Date } | null> {
    const result = await db.query<{ accountId: string; sessionExpiresAt: Date }>(
      `SELECT session.account_id AS "accountId",
              session.expires_at AS "sessionExpiresAt"
       FROM account_sessions AS session
       JOIN account_session_refresh_tokens AS refresh
         ON refresh.session_id = session.id
       JOIN accounts AS account ON account.id = session.account_id
       WHERE session.id = $1
         AND refresh.token_hash = $2
         AND session.revoked_at IS NULL
         AND session.expires_at > CURRENT_TIMESTAMP
         AND account.status = 'ACTIVE'
         AND (account.phone_verified_at IS NOT NULL OR account.email_verified_at IS NOT NULL)
         AND account.deleted_at IS NULL`,
      [sessionId, refreshTokenHash]
    );
    return result.rows[0] ?? null;
  }

  async rotateRefreshSession(input: {
    sessionId: string;
    currentRefreshHash: string;
    nextRefreshHash: string;
    nextRefreshExpiry: Date;
    accessTokenHash: string;
  }): Promise<'rotated' | 'reused' | 'invalid'> {
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      const current = await client.query<{
        usedAt: Date | null;
        tokenExpiresAt: Date;
      }>(
        `SELECT refresh.used_at AS "usedAt",
                refresh.expires_at AS "tokenExpiresAt"
         FROM account_sessions AS session
         JOIN account_session_refresh_tokens AS refresh
           ON refresh.session_id = session.id
         JOIN accounts AS account ON account.id = session.account_id
         WHERE session.id = $1
           AND refresh.token_hash = $2
           AND session.revoked_at IS NULL
           AND session.expires_at > CURRENT_TIMESTAMP
           AND account.status = 'ACTIVE'
           AND (account.phone_verified_at IS NOT NULL OR account.email_verified_at IS NOT NULL)
           AND account.deleted_at IS NULL
         FOR UPDATE OF session, refresh`,
        [input.sessionId, input.currentRefreshHash]
      );
      const token = current.rows[0];
      if (!token) {
        await client.query('COMMIT');
        return 'invalid';
      }

      if (token.usedAt) {
        await client.query(
          `UPDATE account_sessions
           SET revoked_at = CURRENT_TIMESTAMP
           WHERE id = $1 AND revoked_at IS NULL`,
          [input.sessionId]
        );
        await client.query('COMMIT');
        return 'reused';
      }

      if (token.tokenExpiresAt.getTime() <= Date.now()) {
        await client.query('COMMIT');
        return 'invalid';
      }

      await client.query(
        `UPDATE account_session_refresh_tokens
         SET used_at = CURRENT_TIMESTAMP
         WHERE session_id = $1 AND token_hash = $2 AND used_at IS NULL`,
        [input.sessionId, input.currentRefreshHash]
      );
      await client.query(
        `INSERT INTO account_session_refresh_tokens (session_id, token_hash, expires_at)
         VALUES ($1, $2, $3)`,
        [input.sessionId, input.nextRefreshHash, input.nextRefreshExpiry]
      );
      await client.query(
        `UPDATE account_sessions
         SET token_hash = $2
         WHERE id = $1 AND revoked_at IS NULL`,
        [input.sessionId, input.accessTokenHash]
      );
      await client.query('COMMIT');
      return 'rotated';
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async revokeRefreshSession(
    sessionId: string,
    refreshTokenHash: string
  ): Promise<Date | null> {
    const result = await db.query<{ expiresAt: Date }>(
      `UPDATE account_sessions AS session
       SET revoked_at = COALESCE(session.revoked_at, CURRENT_TIMESTAMP)
       WHERE session.id = $1
         AND EXISTS (
           SELECT 1
           FROM account_session_refresh_tokens AS refresh
           WHERE refresh.session_id = session.id
             AND refresh.token_hash = $2
         )
       RETURNING session.expires_at AS "expiresAt"`,
      [sessionId, refreshTokenHash]
    );
    return result.rows[0]?.expiresAt ?? null;
  }

  async findActiveSessionUser(
    accountId: string,
    tokenHash: string
  ): Promise<AuthenticatedUser | null> {
    const result = await db.query(
      `SELECT
         account.id,
         account.account_type,
         account.account_type,
         account.email,
        account.phone_number,
        account.status,
        account.email_verified_at,
        account.phone_verified_at,
        EXISTS (
           SELECT 1
           FROM platform_super_admins AS super_admin
           WHERE super_admin.account_id = account.id
             AND account.account_type = 'ADMIN'
         ) AS is_super_admin
       FROM account_sessions AS session
       JOIN accounts AS account ON account.id = session.account_id
       WHERE session.account_id = $1
         AND session.token_hash = $2
         AND session.revoked_at IS NULL
         AND session.expires_at > CURRENT_TIMESTAMP
         AND account.status = 'ACTIVE'
         AND (account.phone_verified_at IS NOT NULL OR account.email_verified_at IS NOT NULL)
         AND account.deleted_at IS NULL`,
      [accountId, tokenHash]
    );
    return result.rows[0] ?? null;
  }

  async update(id: string, updates: Partial<User>): Promise<User> {
    const entries = Object.entries(updates);
    if (entries.length === 0) throw new ApiError(400, 'No update data provided');

    const columns = entries.map(([key]) => {
      if (!isUserUpdateKey(key)) {
        throw new ApiError(400, `Updating ${key} is not allowed`);
      }

      const column = updateColumns[key];
      if (!column) throw new ApiError(400, `Updating ${key} is not allowed`);
      return column;
    });
    const setClause = columns.map((column, index) => `${column} = $${index + 2}`).join(', ');
    const values = entries.map(([key, value]) =>
      key === 'email' && typeof value === 'string' ? value.trim().toLowerCase() : value
    );

    const query = `
      UPDATE accounts
      SET ${setClause}, updated_at = CURRENT_TIMESTAMP
      WHERE id = $1 AND deleted_at IS NULL
      RETURNING id;
    `;

    const result = await db.query(query, [id, ...values]);
    if (!result.rowCount) throw new ApiError(404, 'User not found');

    const user = await this.findById(id);
    if (!user) throw new ApiError(404, 'User not found');
    return user;
  }
}
