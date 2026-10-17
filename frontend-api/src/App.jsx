import { Routes, Route, Navigate } from "react-router-dom";
import Layout from "./components/Layout.jsx";
import Overview from "./pages/Overview.jsx";
import ApiKeys from "./pages/ApiKeys.jsx";
import Playground from "./pages/Playground.jsx";
import Docs from "./pages/Docs.jsx";
import Usage from "./pages/Usage.jsx";
import Webhooks from "./pages/Webhooks.jsx";
import Pricing from "./pages/Pricing.jsx";
import Generations from "./pages/Generations.jsx";
import Models from "./pages/Models.jsx";
import Team from "./pages/Team.jsx";
import Billing from "./pages/Billing.jsx";
import Settings from "./pages/Settings.jsx";
import Changelog from "./pages/Changelog.jsx";
import Status from "./pages/Status.jsx";

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Overview />} />
        <Route path="keys" element={<ApiKeys />} />
        <Route path="playground" element={<Playground />} />
        <Route path="generations" element={<Generations />} />
        <Route path="models" element={<Models />} />
        <Route path="docs" element={<Docs />} />
        <Route path="changelog" element={<Changelog />} />
        <Route path="status" element={<Status />} />
        <Route path="usage" element={<Usage />} />
        <Route path="webhooks" element={<Webhooks />} />
        <Route path="team" element={<Team />} />
        <Route path="billing" element={<Billing />} />
        <Route path="settings" element={<Settings />} />
        <Route path="pricing" element={<Pricing />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
