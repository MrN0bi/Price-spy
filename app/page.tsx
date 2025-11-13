// app/page.tsx
import MonitorForm from './components/MonitorForm';
import MonitorList from './components/MonitorList';

export default function Page() {
  return (
    <main className="max-w-5xl mx-auto p-6 space-y-6">
      <h1 className="text-2xl font-bold">SaaS Pricing Monitor (MVP)</h1>
      <p className="text-gray-600">
        Add pricing pages to track. Use the <strong>CSS hint picker</strong> to select the exact section
        that contains the pricing cards. We’ll parse inside that scope to find plan names, amounts, and features.
      </p>
      <MonitorForm />
      <div className="h-px bg-gray-200" />
      <div className="space-y-2">
        <h2 className="text-xl font-semibold">Monitors</h2>
        <MonitorList />
      </div>
    </main>
  );
}
