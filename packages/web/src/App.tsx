import { BrowserRouter, Routes, Route } from "react-router-dom";
import { Layout } from "@/components/Layout";
import { RequireAuth } from "@/components/RequireAuth";
import { RequireOrganization } from "@/components/RequireOrganization";
import { Dashboard } from "@/pages/Dashboard";
import { VMDetail } from "@/pages/VMDetail";
import { Images } from "@/pages/Images";
import { Login } from "@/pages/Login";
import { Signup } from "@/pages/Signup";
import { AcceptInvitation } from "@/pages/AcceptInvitation";
import { CreateOrganization } from "@/pages/CreateOrganization";
import { Settings } from "@/pages/Settings";
import { Conversations } from "@/pages/Conversations";
import { Conversation } from "@/pages/Conversation";

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
    <RequireAuth>
      <Layout>
        <Routes>
          <Route
            path="/"
            element={
              <RequireOrganization>
                <Dashboard />
              </RequireOrganization>
            }
          />
          <Route
            path="/vms/:id"
            element={
              <RequireOrganization>
                <VMDetail />
              </RequireOrganization>
            }
          />
          <Route
            path="/conversations"
            element={
              <RequireOrganization>
                <Conversations />
              </RequireOrganization>
            }
          />
          <Route
            path="/conversations/:id"
            element={
              <RequireOrganization>
                <Conversation />
              </RequireOrganization>
            }
          />
          <Route path="/images" element={<Images />} />
          <Route
            path="/settings"
            element={
              <RequireOrganization>
                <Settings />
              </RequireOrganization>
            }
          />
          <Route path="/organizations/new" element={<CreateOrganization />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </Layout>
    </RequireAuth>
  );
}

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/signup" element={<Signup />} />
        <Route path="/invitations/:id" element={<AcceptInvitation />} />
        <Route path="*" element={<LayoutRoutes />} />
      </Routes>
    </BrowserRouter>
  );
}
