"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { LoaderCircle } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Controller, useForm } from "react-hook-form";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PasswordInput } from "@/components/ui/password-input";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { CountryCodeSelect } from "@/features/auth/components/country-code-select";

import { login } from "@/features/auth/services/auth.service";
import {
  loginSchema,
  type LoginValues,
} from "@/features/auth/schemas/login.schema";
import { defaultCountryCode } from "@/features/auth/data/country-codes";

export function LoginForm() {
  const router = useRouter();
  const [serverError, setServerError] = useState<string>();

  const {
    register,
    control,
    handleSubmit,
    setValue,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<LoginValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: {
      identifierType: "email",
      countryCode: defaultCountryCode.dialCode,
    },
  });

  const identifierType = watch("identifierType");
  const identifierOptions = [
    { value: "email", label: "Email" },
    { value: "phone", label: "Phone" },
  ] as const;

  async function onSubmit(values: LoginValues) {
    setServerError(undefined);

    try {
      await login(values);
      router.push("/dashboard");
      router.refresh();
    } catch (error) {
      setServerError(
        error instanceof Error ? error.message : "Unable to sign in",
      );
    }
  }

  return (
    <form className="grid gap-5" onSubmit={handleSubmit(onSubmit)} noValidate>
      {/* Email / Phone Toggle */}
      <div className="grid gap-2">
        <Label>Sign in with</Label>
        <SegmentedControl
          aria-label="Sign in with"
          options={identifierOptions}
          value={identifierType}
          onValueChange={(nextIdentifierType) =>
            setValue("identifierType", nextIdentifierType)
          }
        />
      </div>

      {/* Email / Phone Input */}
      {identifierType === "email" ? (
        <div className="grid gap-2">
          <Label htmlFor="login-email">Email address</Label>

          <Input
            id="login-email"
            type="email"
            autoComplete="email"
            placeholder="you@example.com"
            aria-invalid={Boolean(errors.email)}
            {...register("email")}
          />

          <p className="min-h-5 text-sm text-state-error">
            {errors.email?.message ?? ""}
          </p>
        </div>
      ) : (
        <div className="grid gap-2">
          <Label htmlFor="login-phone-number">Phone number</Label>

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
              id="login-phone-number"
              type="tel"
              inputMode="tel"
              autoComplete="tel-national"
              placeholder="9876543210"
              aria-invalid={Boolean(errors.phoneNumber)}
              {...register("phoneNumber")}
            />
          </div>

          <p className="min-h-5 text-sm text-state-error">
            {errors.phoneNumber?.message ?? ""}
          </p>
        </div>
      )}

      {/* Password */}
      <div className="grid gap-2">
        <div className="flex items-center justify-between gap-3">
          <Label htmlFor="login-password">Password</Label>
          <Link
            className="text-sm font-medium text-link hover:text-link-hover"
            href="/forgot-password"
          >
            Forgot password?
          </Link>
        </div>

        <PasswordInput
          id="login-password"
          autoComplete="current-password"
          aria-invalid={Boolean(errors.password)}
          {...register("password")}
        />

        <p className="min-h-5 text-sm text-state-error">
          {errors.password?.message ?? ""}
        </p>
      </div>

      {/* Server Error */}
      <div className="min-h-12" aria-live="polite">
        {serverError && (
          <Alert variant="error">
            <AlertDescription>{serverError}</AlertDescription>
          </Alert>
        )}
      </div>

      {/* Submit */}
      <Button className="w-full" type="submit" disabled={isSubmitting}>
        {isSubmitting && <LoaderCircle className="animate-spin" />}
        {isSubmitting ? "Signing in..." : "Sign in"}
      </Button>

      {/* Register Link */}
      <p className="text-center text-sm text-text-muted">
        New to Salonix?{" "}
        <Link
          className="font-medium text-text-primary underline underline-offset-4"
          href="/register"
        >
          Create an account
        </Link>
      </p>
    </form>
  );
}
