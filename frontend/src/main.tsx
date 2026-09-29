import React from "react";
import ReactDOM from "react-dom/client";
import { createBrowserRouter, RouterProvider, Link, Outlet } from "react-router-dom";
import Overzicht from "./routes/Overzicht";
import Advies from "./routes/Advies";

function Layout() {
  const nav = {
    display: "flex", gap: 4, padding: "12px 20px",
    background: "#0b0f14", borderBottom: "1px solid #2a3744",
    position: "sticky" as const, top: 0, zIndex: 10,
  };
  const link = (active: boolean) => ({
    color: active ? "#f0a32a" : "#8b9aa8",
    textDecoration: "none", fontWeight: 600, fontSize: 14,
    padding: "8px 14px", borderRadius: 8,
    background: active ? "#171e26" : "transparent",
    fontFamily: "'Inter', system-ui, sans-serif",
  });
  const path = window.location.pathname;
  return (
    <div style={{ minHeight: "100vh", background: "#0f1419" }}>
      <nav style={nav}>
        <Link to="/" style={link(path === "/")}>Overzicht</Link>
        <Link to="/advies" style={link(path.startsWith("/advies"))}>Advies</Link>
      </nav>
      <Outlet />
    </div>
  );
}

const router = createBrowserRouter([
  {
    path: "/",
    element: <Layout />,
    children: [
      { index: true, element: <Overzicht /> },
      { path: "advies", element: <Advies /> },
    ],
  },
]);

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <RouterProvider router={router} />
  </React.StrictMode>
);
