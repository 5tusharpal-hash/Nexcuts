"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { LoaderCircle } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PasswordInput } from "@/components/ui/password-input";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { CountryCodeSelect } from "@/features/auth/components/country-code-select";
import { defaultCountryCode } from "@/features/auth/data/country-codes";
import {
  passwordResetCompletionSchema,
  passwordResetRequestSchema,
  type PasswordResetCompletionValues,
  type PasswordResetRequestValues,
} from "@/features/auth/schemas/password-reset.schema";
import {
  completePasswordReset,
  requestPasswordReset,
} from "@/features/auth/services/auth.service";

type ResetStage = "request" | "verify" | "success";

const identifierOptions = [
  { value: "email", label: "Email" },
  { value: "phone", label: "Phone" },
] as const;

export function ForgotPasswordForm() {
  const [stage, setStage] = useState<ResetStage>("request");
  const [identifier, setIdentifier] = useState("");
  const [serverError, setServerError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [developmentOtp, setDevelopmentOtp] = useState<string>();
  const [isResending, setIsResending] = useState(false);

  const {
    register: registerIdentifier,
    control,
    handleSubmit: handleIdentifierSubmit,
    setValue,
    watch,
    formState: { errors: identifierErrors, isSubmitting: isRequesting },
  } = useForm<PasswordResetRequestValues>({
    resolver: zodResolver(passwordResetRequestSchema),
    defaultValues: {
      identifierType: "email",
      countryCode: defaultCountryCode.dialCode,
    },
  });

  const {
    register: registerReset,
    handleSubmit: handleResetSubmit,
    formState: { errors: resetErrors, isSubmitting: isResetting },
  } = useForm<PasswordResetCompletionValues>({
    resolver: zodResolver(passwordResetCompletionSchema),
  });

  const identifierType = watch("identifierType");

  async function onRequestCode(values: PasswordResetRequestValues) {
    const normalizedIdentifier = values.identifierType === "email"
      ? values.email?.trim().toLowerCase() ?? ""
      : `${values.countryCode}${values.phoneNumber?.replace(/^0+/, "") ?? ""}`;

    setServerError(undefined);
    setNotice(undefined);
    setDevelopmentOtp(undefined);

    try {
      const response = await requestPasswordReset(normalizedIdentifier);
      setIdentifier(normalizedIdentifier);
      setNotice(
        response.data?.message ??
          "If the account exists, a reset code has been sent.",
      );
      setDevelopmentOtp(response.data?.developmentOtp);
      setStage("verify");
    } catch (error) {
      setServerError(
        error instanceof Error ? error.message : "Unable to request a reset code",
      );
    }
  }

  async function onResendCode() {
    if (!identifier) return;

    setServerError(undefined);
    setNotice(undefined);
    setDevelopmentOtp(undefined);
    setIsResending(true);

    try {
      const response = await requestPasswordReset(identifier);
      setNotice(
        response.data?.message ??
          "If the account exists, a reset code has been sent.",
      );
      setDevelopmentOtp(response.data?.developmentOtp);
    } catch (error) {
      setServerError(
        error instanceof Error ? error.message : "Unable to resend the reset code",
      );
    } finally {
      setIsResending(false);
    }
  }

  async function onCompleteReset(values: PasswordResetCompletionValues) {
    if (!identifier) {
      setServerError("Request a reset code before changing your password.");
      setStage("request");
      return;
    }

    setServerError(undefined);
    try {
      const response = await completePasswordReset(
        identifier,
        values.code,
        values.newPassword,
      );
      setNotice(
        response.data?.message ??
          "Password reset successfully. Sign in with your new password.",
      );
      setStage("success");
    } catch (error) {
      setServerError(
        error instanceof Error ? error.message : "Unable to reset your password",
      );
    }
  }

  function useDifferentIdentifier() {
    setServerError(undefined);
    setNotice(undefined);
    setDevelopmentOtp(undefined);
    setStage("request");
  }

  if (stage === "success") {
    return (
      <div className="grid gap-5">
        <Alert variant="success">
          <AlertDescription>{notice}</AlertDescription>
        </Alert>
        <Button className="w-full" asChild>
          <Link href="/login">Back to sign in</Link>
        </Button>
      </div>
    );
  }

  if (stage === "verify") {
    return (
      <div className="grid gap-5">
        <p className="text-sm text-text-muted">
          Enter the code sent to{" "}
          <strong className="text-text-primary">{identifier}</strong>.
        </p>
        {notice && (
          <Alert variant="info">
            <AlertDescription>{notice}</AlertDescription>
          </Alert>
        )}
        {developmentOtp && (
          <Alert variant="info">
            <AlertDescription>
              Development code: <strong>{developmentOtp}</strong>
            </AlertDescription>
          </Alert>
        )}
        <form
          className="grid gap-4"
          onSubmit={handleResetSubmit(onCompleteReset)}
          noValidate
        >
          <div className="grid gap-2">
            <Label htmlFor="password-reset-code">6-digit reset code</Label>
            <Input
              id="password-reset-code"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              className="text-center text-lg tracking-[0.45em]"
              aria-invalid={Boolean(resetErrors.code)}
              {...registerReset("code")}
            />
            <p className="min-h-5 text-sm text-state-error">
              {resetErrors.code?.message ?? ""}
            </p>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="password-reset-new-password">New password</Label>
            <PasswordInput
              id="password-reset-new-password"
              autoComplete="new-password"
              aria-invalid={Boolean(resetErrors.newPassword)}
              {...registerReset("newPassword")}
            />
            <p className="min-h-5 text-sm text-state-error">
              {resetErrors.newPassword?.message ?? ""}
            </p>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="password-reset-confirm-password">
              Confirm new password
            </Label>
            <PasswordInput
              id="password-reset-confirm-password"
              autoComplete="new-password"
              aria-invalid={Boolean(resetErrors.confirmPassword)}
              {...registerReset("confirmPassword")}
            />
            <p className="min-h-5 text-sm text-state-error">
              {resetErrors.confirmPassword?.message ?? ""}
            </p>
          </div>
          <div className="min-h-12" aria-live="polite">
            {serverError && (
              <Alert variant="error">
                <AlertDescription>{serverError}</AlertDescription>
              </Alert>
            )}
          </div>
          <Button className="w-full" type="submit" disabled={isResetting}>
            {isResetting && <LoaderCircle className="animate-spin" />}
            {isResetting ? "Resetting password..." : "Reset password"}
          </Button>
        </form>
        <div className="flex flex-wrap justify-between gap-3 text-sm">
          <Button
            type="button"
            variant="link"
            className="h-auto p-0"
            onClick={onResendCode}
            disabled={isResending || isResetting}
          >
            {isResending ? "Sending code..." : "Resend code"}
          </Button>
          <Button
            type="button"
            variant="link"
            className="h-auto p-0"
            onClick={useDifferentIdentifier}
            disabled={isResending || isResetting}
          >
            Use a different email or phone
          </Button>
        </div>
      </div>
    );
  }

  return (
    <form
      className="grid gap-5"
      onSubmit={handleIdentifierSubmit(onRequestCode)}
      noValidate
    >
      <div className="grid gap-2">
        <Label>Send a reset code to</Label>
        <SegmentedControl
          aria-label="Choose email or phone"
          options={identifierOptions}
          value={identifierType}
          onValueChange={(nextIdentifierType) =>
            setValue("identifierType", nextIdentifierType)
          }
        />
      </div>

      {identifierType === "email" ? (
        <div className="grid gap-2">
          <Label htmlFor="password-reset-email">Email address</Label>
          <Input
            id="password-reset-email"
            type="email"
            autoComplete="email"
            placeholder="you@example.com"
            aria-invalid={Boolean(identifierErrors.email)}
            {...registerIdentifier("email")}
          />
          <p className="min-h-5 text-sm text-state-error">
            {identifierErrors.email?.message ?? ""}
          </p>
        </div>
      ) : (
        <div className="grid gap-2">
          <Label htmlFor="password-reset-phone">Phone number</Label>
          <div className="flex gap-2">
            <Controller
              control={control}
              name="countryCode"
              render={({ field }) => (
                <CountryCodeSelect
                  aria-label="Country code"
                  value={field.value}
                  onValueChange={field.onChange}
                />
              )}
            />
            <Input
              className="min-w-0 flex-1"
              id="password-reset-phone"
              type="tel"
              inputMode="tel"
              autoComplete="tel-national"
              placeholder="9876543210"
              aria-invalid={Boolean(identifierErrors.phoneNumber)}
              {...registerIdentifier("phoneNumber")}
            />
          </div>
          <p className="min-h-5 text-sm text-state-error">
            {identifierErrors.phoneNumber?.message ?? ""}
          </p>
        </div>
      )}

      <div className="min-h-12" aria-live="polite">
        {serverError && (
          <Alert variant="error">
            <AlertDescription>{serverError}</AlertDescription>
          </Alert>
        )}
      </div>
      <Button className="w-full" type="submit" disabled={isRequesting}>
        {isRequesting && <LoaderCircle className="animate-spin" />}
        {isRequesting ? "Sending code..." : "Send reset code"}
      </Button>
      <p className="text-center text-sm text-text-muted">
        Remember your password?{" "}
        <Link
          className="font-medium text-text-primary underline underline-offset-4"
          href="/login"
        >
          Sign in
        </Link>
      </p>
    </form>
  );
}
