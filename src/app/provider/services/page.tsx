import ProviderServiceForm from "@/components/ProviderServiceForm";

export default function ProviderServicesPage() {
  return (
    <main className="min-h-screen bg-zinc-50 px-6 py-12 text-zinc-950 dark:bg-zinc-950 dark:text-zinc-50 sm:px-10">
      <div className="mx-auto max-w-2xl">
        <h1 className="text-3xl font-semibold tracking-tight">
          Submit a neighborhood service
        </h1>
        <p className="mt-3 text-zinc-600 dark:text-zinc-300">
          Provider accounts can save a draft and submit it for administrator review.
        </p>
        <div className="mt-8 rounded-2xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
          <ProviderServiceForm />
        </div>
      </div>
    </main>
  );
}
