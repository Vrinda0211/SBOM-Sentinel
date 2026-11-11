import { Suspense } from "react";
import { redirect } from "next/navigation";
import LoginForm from "./login-form";
import { getCurrentUser } from "@/server/auth";

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <main
          aria-busy="true"
          className="flex flex-1 items-center justify-center px-5 py-12 sm:px-8"
        >
          <p className="text-sm text-slate-600" role="status">
            Loading sign-in...
          </p>
        </main>
      }
    >
      <LoginPageContent />
    </Suspense>
  );
}

async function LoginPageContent() {
  if (await getCurrentUser()) {
    redirect("/");
  }

  return (
    <main className="flex flex-1 items-center justify-center px-5 py-12 sm:px-8">
      <section className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-7 shadow-sm sm:p-9">
        <p className="text-sm font-semibold text-emerald-800">
          SBOM Sentinel
        </p>
        <h1 className="mt-2 text-2xl font-bold tracking-tight text-slate-950">
          Sign in to your workspace
        </h1>
        <p className="mt-2 text-sm leading-6 text-slate-600">
          Use your project account to review applications and supply-chain
          findings.
        </p>
        <LoginForm />
      </section>
    </main>
  );
}
