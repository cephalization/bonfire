import { BrowserRouter, Routes, Route } from "react-router-dom";
import { Layout } from "@/components/Layout";
import { Dashboard } from "@/pages/Dashboard";
import { VMDetail } from "@/pages/VMDetail";
import { Images } from "@/pages/Images";
import { Login } from "@/pages/Login";
import { AgentSessionsPage } from "@/pages/AgentSessions";
import { AgentSessionDetailPage } from "@/pages/AgentSessionDetail";

function Settings() {
  return (
    <div>
      <h1 className="text-2xl font-bold">Settings</h1>
      <p className="mt-4 text-muted-foreground">Settings page placeholder</p>
    </div>
  );
}

function NotFound() {
  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center">
      <h1 className="text-4xl font-bold">404</h1>
      <p className="mt-2 text-muted-foreground">Page not found</p>
    </div>
  );
}

// Wrap routes that need the layout
function LayoutRoutes() {
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/vms/:id" element={<VMDetail />} />
        <Route path="/agent/sessions" element={<AgentSessionsPage />} />
        <Route path="/agent/sessions/:id" element={<AgentSessionDetailPage />} />
        <Route path="/images" element={<Images />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </Layout>
  );
}

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="*" element={<LayoutRoutes />} />
      </Routes>
    </BrowserRouter>
  );
}
