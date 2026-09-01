import * as React from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  LayoutGrid,
  ShoppingBag,
  List,
  FileText,
  Users,
  Gift,
  PieChart,
  MapPin,
  Settings,
  LogOut,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useIsMobile } from "@/hooks/use-mobile";
import { SidebarHeader } from "./SidebarHeader";
import { SidebarUser } from "./SidebarUser";
import { SidebarNavItem, type NavItem } from "./SidebarNavItem";
import { SidebarDarkModeToggle } from "./SidebarDarkModeToggle";

export const DEFAULT_NAV_ITEMS: NavItem[] = [
  { id: "dashboard", label: "Dashboard", icon: LayoutGrid },
  { id: "products", label: "Products", icon: ShoppingBag },
  { id: "categories", label: "Categories", icon: List },
  { id: "orders", label: "Orders", icon: FileText },
  { id: "customers", label: "Customers", icon: Users },
  { id: "offers", label: "Sales Offers", icon: Gift },
  { id: "dealership", label: "Dealership", icon: PieChart },
  { id: "locations", label: "Locations", icon: MapPin },
  { id: "settings", label: "Settings", icon: Settings },
  { id: "logout", label: "Logout", icon: LogOut, variant: "logout" },
];

type SidebarProps = {
  items?: NavItem[];
  brandName?: string;
  brandIcon?: LucideIcon;
  user?: { name: string; role: string; avatarUrl?: string };
  /** Persist expand/collapse state across reloads. */
  persist?: boolean;
  /** On mobile, expand as an overlay drawer instead of pushing content. */
  overlayOnMobile?: boolean;
  className?: string;
  onNavigate?: (id: string) => void;
};

function useDarkMode(persist = true) {
  const [dark, setDark] = React.useState<boolean>(() => {
    if (!persist) return false;
    const stored = localStorage.getItem("sidebar-dark");
    if (stored != null) return stored === "true";
    return window.matchMedia("(prefers-color-scheme: dark)").matches;
  });

  React.useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle("dark", dark);
    if (persist) localStorage.setItem("sidebar-dark", String(dark));
  }, [dark, persist]);

  return { dark, setDark };
}

export function Sidebar({
  items = DEFAULT_NAV_ITEMS,
  brandName = "Shopping",
  brandIcon = ShoppingBag,
  user = { name: "Jane Cooper", role: "Store Admin" },
  persist = true,
  overlayOnMobile = true,
  className,
  onNavigate,
}: SidebarProps) {
  const isMobile = useIsMobile();
  const [expanded, setExpanded] = React.useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    const stored = localStorage.getItem("sidebar-expanded");
    if (stored != null) return stored === "true";
    return false;
  });
  const [activeId, setActiveId] = React.useState<string>("dashboard");
  const { dark, setDark } = useDarkMode(persist);

  const isOverlay = overlayOnMobile && isMobile && expanded;

  const toggleExpanded = React.useCallback(() => {
    setExpanded((prev) => {
      const next = !prev;
      if (persist) localStorage.setItem("sidebar-expanded", String(next));
      return next;
    });
  }, [persist]);

  const handleSelect = React.useCallback(
    (id: string) => {
      setActiveId(id);
      onNavigate?.(id);
      if (overlayOnMobile && isMobile) setExpanded(false);
    },
    [onNavigate, overlayOnMobile, isMobile],
  );

  const sidebar = (
    <motion.aside
      animate={{ width: expanded ? 280 : 64 }}
      transition={{ duration: 0.3, ease: "easeOut" }}
      className={cn(
        "flex h-full flex-col overflow-hidden rounded-2xl bg-white p-2 shadow-lg ring-1 ring-black/5",
        className,
      )}
    >
      <SidebarHeader
        expanded={expanded}
        brandName={brandName}
        brandIcon={brandIcon}
        onToggle={toggleExpanded}
      />

      <SidebarUser
        expanded={expanded}
        name={user.name}
        role={user.role}
        avatarUrl={user.avatarUrl}
      />

      <div className="mx-2 my-1 h-px bg-gray-200" />

      <nav className="flex-1 overflow-y-auto py-1">
        {items.map((item, i) => (
          <SidebarNavItem
            key={item.id}
            item={item}
            index={i}
            active={item.id === activeId}
            expanded={expanded}
            onSelect={handleSelect}
          />
        ))}
      </nav>

      <div className="mx-2 mb-1 mt-1 h-px bg-gray-200" />

      <SidebarDarkModeToggle
        dark={dark}
        expanded={expanded}
        onToggle={() => setDark((d) => !d)}
        index={items.length}
      />
    </motion.aside>
  );

  if (isOverlay) {
    return (
      <>
        <AnimatePresence>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setExpanded(false)}
            className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm"
          />
        </AnimatePresence>
        <div className="fixed inset-y-0 left-0 z-50 p-3">{sidebar}</div>
      </>
    );
  }

  return sidebar;
}

export default Sidebar;
