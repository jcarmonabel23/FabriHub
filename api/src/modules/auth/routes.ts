/**
 * @project FabriHub - API
 * @file src/modules/auth/routes.ts
 * @description Rutas de autenticación (/api/v1/auth)
 */

import { Router } from "express";
import { authenticate } from "../../security/authenticate.js";
import { authLimiter, refreshLimiter } from "../../security/rateLimits.js";
import { changePassword } from "./changePassword.js";
import { logout, logoutAll } from "./logout.js";
import { me } from "./me.js";
import { otpResend } from "./otpResend.js";
import { otpVerify } from "./otpVerify.js";
import { forgotPassword, resetPassword } from "./passwordReset.js";
import { refresh } from "./refresh.js";
import { signIn } from "./signIn.js";

export const authRoutes = Router();

const pending = authenticate({ allowPendingPasswordChange: true });

authRoutes.post("/sign-in", authLimiter, signIn);
authRoutes.post("/otp/verify", authLimiter, otpVerify);
authRoutes.post("/otp/resend", authLimiter, otpResend);
authRoutes.post("/forgot-password", authLimiter, forgotPassword);
authRoutes.post("/reset-password", authLimiter, resetPassword);

authRoutes.post("/refresh", refreshLimiter, refresh);
authRoutes.post("/logout", logout);
authRoutes.post("/logout-all", pending, logoutAll);

authRoutes.get("/me", pending, me);
authRoutes.post("/change-password", authLimiter, pending, changePassword);
