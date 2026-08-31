import { Outlet } from "react-router-dom";
import Sidebar from "./Sidebar.jsx";
import TopBar from "./TopBar.jsx";
import ToastStack from "./ToastStack.jsx";

export default function Layout() {
  return (
    <div className="app-shell">
      <div className="app-fx" aria-hidden="true" />
      <Sidebar />
      <div className="main-area">
        <TopBar />
        <div className="page-content">
          <Outlet />
        </div>
      </div>
      <ToastStack />
    </div>
  );
}
