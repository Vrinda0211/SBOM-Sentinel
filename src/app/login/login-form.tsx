"use client";

import { useActionState } from "react";
import { loginAction, type LoginFormState } from "../auth-actions";

const initialState: LoginFormState = {};
const fieldClass =
  "mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-950 outline-none transition focus:border-emerald-700 focus:ring-2 focus:ring-emerald-700/20";

export default function LoginForm() {
  const [state, formAction, isPending] = useActionState(
    loginAction,
    initialState,
  );

  return (
    <form action={formAction} className="mt-7 space-y-5">
      <label className="block text-sm font-medium text-slate-700">
        Username or email
        <input
          autoComplete="username"
          className={fieldClass}
          maxLength={254}
          name="identity"
          required
        />
      </label>
      <label className="block text-sm font-medium text-slate-700">
        Password
        <input
          autoComplete="current-password"
          className={fieldClass}
          maxLength={72}
          name="password"
          required
          type="password"
        />
      </label>
      {state.error && (
        <p
          className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"
          role="alert"
        >
          {state.error}
        </p>
      )}
      <button
        className="w-full rounded-lg bg-emerald-800 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-900 disabled:cursor-wait disabled:opacity-60"
        disabled={isPending}
        type="submit"
      >
        {isPending ? "Signing in..." : "Sign in"}
      </button>
    </form>
  );
}
