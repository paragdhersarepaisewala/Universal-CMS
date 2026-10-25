import { FastifyInstance, FastifyPluginAsync, FastifyReply } from 'fastify';
import { Type } from '@sinclair/typebox';
import { authService } from '../auth/service.js';
import { authenticate, extractToken } from '../auth/middleware.js';

interface CustomError {
  statusCode?: number;
  code?: string;
  message?: string;
}

function handleAuthError(err: unknown, reply: FastifyReply, defaultStatus = 400) {
  const error = err as CustomError;
  const statusCode = error.statusCode || defaultStatus;
  return reply.status(statusCode).send({
    error: {
      code: error.code || 'VALIDATION_FAILED',
      message: error.message || 'An unexpected error occurred',
    },
  });
}

const UserResponseSchema = Type.Object({
  id: Type.Number(),
  name: Type.String(),
  email: Type.String(),
  roleId: Type.Number(),
  roleName: Type.Optional(Type.String()),
  isActive: Type.Boolean(),
  emailVerifiedAt: Type.Union([Type.String(), Type.Null()]),
  twoFactorEnabled: Type.Boolean(),
  dateOfBirth: Type.Optional(Type.Union([Type.String(), Type.Null()])),
});

const ErrorResponseSchema = Type.Object({
  error: Type.Object({
    code: Type.String(),
    message: Type.String(),
  }),
});

export const authRoutes: FastifyPluginAsync = async (fastify: FastifyInstance) => {
  // 1. POST /signup
  fastify.post(
    '/signup',
    {
      schema: {
        description: 'Customer or user registration',
        tags: ['Auth'],
        body: Type.Object({
          name: Type.String({ minLength: 2, maxLength: 255 }),
          email: Type.String({ format: 'email' }),
          password: Type.String({ minLength: 8, maxLength: 100 }),
          date_of_birth: Type.Optional(Type.String({ pattern: '^\\d{4}-\\d{2}-\\d{2}$' })),
        }),
        response: {
          201: Type.Object({
            data: Type.Object({
              user: UserResponseSchema,
              verification_required: Type.Boolean(),
              verification_token: Type.Optional(Type.String()),
              verification_code: Type.Optional(Type.String()),
            }),
          }),
          409: ErrorResponseSchema,
          422: ErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const body = request.body as {
        name: string;
        email: string;
        password: string;
        date_of_birth?: string;
      };

      try {
        const result = await authService.signup({
          name: body.name,
          email: body.email,
          password: body.password,
          dateOfBirth: body.date_of_birth,
        });

        return reply.status(201).send({
          data: {
            user: result.user,
            verification_required: true,
            verification_token: result.verificationToken,
            verification_code: result.verificationCode,
          },
        });
      } catch (err: unknown) {
        return handleAuthError(err, reply, 400);
      }
    }
  );

  // 2. POST /verify-email
  fastify.post(
    '/verify-email',
    {
      schema: {
        description: 'Verify user registration with token or 6-digit code',
        tags: ['Auth'],
        body: Type.Object({
          token: Type.Optional(Type.String()),
          code: Type.Optional(Type.String()),
          email: Type.Optional(Type.String({ format: 'email' })),
        }),
        response: {
          200: Type.Object({
            data: Type.Object({
              verified: Type.Boolean(),
            }),
          }),
          422: ErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const body = request.body as { token?: string; code?: string; email?: string };
      const tokenOrCode = body.token || body.code;

      if (!tokenOrCode) {
        return reply.status(422).send({
          error: {
            code: 'VALIDATION_FAILED',
            message: 'A verification token or 6-digit code is required.',
          },
        });
      }

      try {
        const result = await authService.verifyEmail(tokenOrCode, body.email);
        return reply.send({ data: result });
      } catch (err: unknown) {
        return handleAuthError(err, reply, 422);
      }
    }
  );

  // 3. POST /resend-verification
  fastify.post(
    '/resend-verification',
    {
      schema: {
        description: 'Resend email verification code subject to rate limits',
        tags: ['Auth'],
        body: Type.Object({
          email: Type.String({ format: 'email' }),
        }),
        response: {
          200: Type.Object({
            data: Type.Object({
              message: Type.String(),
              verification_token: Type.Optional(Type.String()),
              verification_code: Type.Optional(Type.String()),
            }),
          }),
          429: ErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const body = request.body as { email: string };

      try {
        const result = await authService.resendVerification(body.email);
        return reply.send({
          data: {
            message: result.message,
            verification_token: result.verificationToken,
            verification_code: result.verificationCode,
          },
        });
      } catch (err: unknown) {
        return handleAuthError(err, reply, 400);
      }
    }
  );

  // 4. POST /login
  fastify.post(
    '/login',
    {
      schema: {
        description: 'User login with password verification, rate-limiting lockout, and optional 2FA',
        tags: ['Auth'],
        body: Type.Object({
          email: Type.String({ format: 'email' }),
          password: Type.String(),
          two_factor_code: Type.Optional(Type.String()),
        }),
        response: {
          200: Type.Object({
            data: Type.Object({
              user: Type.Optional(UserResponseSchema),
              token: Type.Optional(Type.String()),
              expires_at: Type.Optional(Type.String()),
              requires_2fa: Type.Optional(Type.Boolean()),
              temp_token: Type.Optional(Type.String()),
            }),
          }),
          401: ErrorResponseSchema,
          403: ErrorResponseSchema,
          429: ErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const body = request.body as {
        email: string;
        password: string;
        two_factor_code?: string;
      };

      try {
        const result = await authService.login({
          email: body.email,
          password: body.password,
          twoFactorCode: body.two_factor_code,
          ipAddress: request.ip,
          userAgent: request.headers['user-agent'],
        });

        return reply.send({
          data: {
            user: result.user,
            token: result.token,
            expires_at: result.expiresAt,
            requires_2fa: result.requires2fa,
            temp_token: result.tempToken,
          },
        });
      } catch (err: unknown) {
        return handleAuthError(err, reply, 401);
      }
    }
  );

  // 5. POST /logout
  fastify.post(
    '/logout',
    {
      preHandler: [authenticate],
      schema: {
        description: 'Invalidate current user session',
        tags: ['Auth'],
        security: [{ bearerAuth: [] }],
        response: {
          200: Type.Object({
            data: Type.Object({
              success: Type.Boolean(),
            }),
          }),
          401: ErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const token = extractToken(request);
      if (token) {
        await authService.logout(token);
      }
      return reply.send({ data: { success: true } });
    }
  );

  // 6. POST /forgot-password
  fastify.post(
    '/forgot-password',
    {
      schema: {
        description: 'Request a password reset link',
        tags: ['Auth'],
        body: Type.Object({
          email: Type.String({ format: 'email' }),
        }),
        response: {
          200: Type.Object({
            data: Type.Object({
              message: Type.String(),
              reset_token: Type.Optional(Type.String()),
            }),
          }),
        },
      },
    },
    async (request, reply) => {
      const body = request.body as { email: string };
      const result = await authService.forgotPassword(body.email);
      return reply.send({
        data: {
          message: result.message,
          reset_token: result.resetToken,
        },
      });
    }
  );

  // 7. POST /reset-password
  fastify.post(
    '/reset-password',
    {
      schema: {
        description: 'Set a new password using a reset token',
        tags: ['Auth'],
        body: Type.Object({
          token: Type.String(),
          new_password: Type.String({ minLength: 8 }),
        }),
        response: {
          200: Type.Object({
            data: Type.Object({
              success: Type.Boolean(),
              message: Type.String(),
            }),
          }),
          422: ErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const body = request.body as { token: string; new_password: string };

      try {
        await authService.resetPassword(body.token, body.new_password);
        return reply.send({
          data: {
            success: true,
            message: 'Password reset successfully. Please log in with your new password.',
          },
        });
      } catch (err: unknown) {
        return handleAuthError(err, reply, 422);
      }
    }
  );

  // 8. POST /2fa/setup
  fastify.post(
    '/2fa/setup',
    {
      preHandler: [authenticate],
      schema: {
        description: 'Initiate 2FA setup by generating a TOTP secret',
        tags: ['Auth'],
        security: [{ bearerAuth: [] }],
        response: {
          200: Type.Object({
            data: Type.Object({
              secret: Type.String(),
              otp_auth_uri: Type.String(),
            }),
          }),
          401: ErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const user = request.user!;
      const result = await authService.setup2FA(user.id);
      return reply.send({
        data: {
          secret: result.secret,
          otp_auth_uri: result.otpAuthUri,
        },
      });
    }
  );

  // 9. POST /2fa/enable
  fastify.post(
    '/2fa/enable',
    {
      preHandler: [authenticate],
      schema: {
        description: 'Verify TOTP code and enable 2FA for the account',
        tags: ['Auth'],
        security: [{ bearerAuth: [] }],
        body: Type.Object({
          code: Type.String({ minLength: 6, maxLength: 6 }),
        }),
        response: {
          200: Type.Object({
            data: Type.Object({
              enabled: Type.Boolean(),
            }),
          }),
          401: ErrorResponseSchema,
          422: ErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const user = request.user!;
      const body = request.body as { code: string };

      try {
        await authService.enable2FA(user.id, body.code);
        return reply.send({ data: { enabled: true } });
      } catch (err: unknown) {
        return handleAuthError(err, reply, 422);
      }
    }
  );

  // 10. GET /me
  fastify.get(
    '/me',
    {
      preHandler: [authenticate],
      schema: {
        description: 'Retrieve current authenticated user session',
        tags: ['Auth'],
        security: [{ bearerAuth: [] }],
        response: {
          200: Type.Object({
            data: UserResponseSchema,
          }),
          401: ErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      return reply.send({ data: request.user });
    }
  );
};
