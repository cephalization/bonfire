import { useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import {
  Menu,
  LayoutDashboard,
  Image,
  MessagesSquare,
  LogOut,
  User,
  Flame,
  Settings as SettingsIcon,
  Building2,
  ChevronsUpDown,
  Plus,
  Check,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerClose,
} from "@/components/ui/drawer";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { authClient, useSession } from "@/lib/auth";

interface LayoutProps {
  children: React.ReactNode;
}

const navItems = [
  { path: "/", label: "Dashboard", icon: LayoutDashboard },
  { path: "/conversations", label: "Chats", icon: MessagesSquare },
  { path: "/images", label: "Images", icon: Image },
  { path: "/settings", label: "Settings", icon: SettingsIcon },
];

function NavLink({
  to,
  children,
  icon: Icon,
  onClick,
  mobile = false,
}: {
  to: string;
  children: React.ReactNode;
  icon: React.ComponentType<{ className?: string }>;
  onClick?: () => void;
  mobile?: boolean;
}) {
  const location = useLocation();
  const isActive = to === "/" ? location.pathname === "/" : location.pathname.startsWith(to);

  return (
    <Link
      to={to}
      onClick={onClick}
      className={cn(
        "flex items-center gap-3 rounded-md transition-colors",
        "min-h-[44px] px-3 py-2", // Touch-friendly (44px min)
        mobile ? "text-lg" : "text-sm",
        isActive
          ? "bg-primary text-primary-foreground"
          : "hover:bg-accent hover:text-accent-foreground"
      )}
    >
      <Icon className="size-5 shrink-0" />
      <span>{children}</span>
    </Link>
  );
}

function Logo({ mobile = false }: { mobile?: boolean }) {
  return (
    <div className={cn("flex items-center gap-2 font-semibold", mobile ? "text-xl" : "text-lg")}>
      <Flame className={cn("text-primary", mobile ? "size-7" : "size-6")} />
      <span>Bonfire</span>
    </div>
  );
}

/**
 * Switch between the organizations the user belongs to. Changing the active
 * organization is a session-level setting, so every page follows it.
 */
export function OrganizationSwitcher({ className }: { className?: string }) {
  const navigate = useNavigate();
  const { data: organizations } = authClient.useListOrganizations();
  const { data: active } = authClient.useActiveOrganization();

  const switchTo = async (organizationId: string) => {
    if (organizationId === active?.id) return;
    await authClient.organization.setActive({ organizationId });
    navigate("/");
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          className={cn("min-h-[44px] w-full justify-between", className)}
          aria-label="Switch organization"
        >
          <span className="flex min-w-0 items-center gap-2">
            <Building2 className="size-4 shrink-0" />
            <span className="truncate">{active?.name ?? "No organization"}</span>
          </span>
          <ChevronsUpDown className="size-4 shrink-0 opacity-60" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        <DropdownMenuLabel>Organizations</DropdownMenuLabel>
        {(organizations ?? []).map((org) => (
          <DropdownMenuItem
            key={org.id}
            onClick={() => switchTo(org.id)}
            className="min-h-[40px] cursor-pointer"
          >
            <span className="flex-1 truncate">{org.name}</span>
            {org.id === active?.id && <Check className="size-4" />}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild className="min-h-[40px] cursor-pointer">
          <Link to="/organizations/new">
            <Plus className="mr-2 size-4" />
            New organization
          </Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function useCurrentUser() {
  const { data: session } = useSession();
  return {
    name: session?.user.name || "User",
    email: session?.user.email || "",
  };
}

function UserMenu() {
  const navigate = useNavigate();
  const { name, email } = useCurrentUser();

  const handleLogout = async () => {
    await authClient.signOut();
    navigate("/login");
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="size-10 min-h-[44px] min-w-[44px]"
          aria-label="User menu"
        >
          <User className="size-5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <div className="px-2 py-1.5">
          <p className="text-sm font-medium">{name}</p>
          <p className="text-xs text-muted-foreground">{email}</p>
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onClick={handleLogout}
          className="min-h-[44px] cursor-pointer text-destructive focus:text-destructive"
        >
          <LogOut className="mr-2 size-4" />
          Log out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function DesktopSidebar() {
  const { name, email } = useCurrentUser();

  return (
    <aside className="fixed left-0 top-0 z-40 hidden h-screen w-64 flex-col border-r bg-background lg:flex">
      <div className="flex h-16 items-center border-b px-6">
        <Logo />
      </div>
      <div className="border-b p-4">
        <OrganizationSwitcher />
      </div>
      <nav className="flex-1 space-y-1 p-4">
        {navItems.map((item) => (
          <NavLink key={item.path} to={item.path} icon={item.icon}>
            {item.label}
          </NavLink>
        ))}
      </nav>
      <div className="border-t p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex size-10 min-h-[44px] min-w-[44px] items-center justify-center rounded-full bg-muted">
              <User className="size-5 text-muted-foreground" />
            </div>
            <div className="hidden xl:block">
              <p className="text-sm font-medium">{name}</p>
              <p className="text-xs text-muted-foreground">{email}</p>
            </div>
          </div>
          <UserMenu />
        </div>
      </div>
    </aside>
  );
}

function MobileHeader({ onMenuOpen }: { onMenuOpen: () => void }) {
  return (
    <header className="fixed left-0 right-0 top-0 z-40 flex h-16 items-center justify-between border-b bg-background px-4 lg:hidden">
      <Logo />
      <div className="flex items-center gap-2">
        <UserMenu />
        <Button
          variant="ghost"
          size="icon"
          onClick={onMenuOpen}
          className="size-10 min-h-[44px] min-w-[44px]"
          aria-label="Open menu"
        >
          <Menu className="size-6" />
        </Button>
      </div>
    </header>
  );
}

function MobileMenu({
  isOpen,
  onOpenChange,
}: {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { name, email } = useCurrentUser();

  // Close menu when location changes (navigation occurs)
  const handleNavClick = () => {
    onOpenChange(false);
  };

  return (
    <Drawer open={isOpen} onOpenChange={onOpenChange} direction="left">
      <DrawerContent className="h-full w-[280px] border-r p-0">
        <DrawerHeader className="border-b px-4 pb-4 pt-4">
          <DrawerTitle>
            <Logo mobile />
          </DrawerTitle>
        </DrawerHeader>
        <div className="border-b p-4">
          <OrganizationSwitcher />
        </div>
        <nav className="flex-1 space-y-1 p-4">
          {navItems.map((item) => (
            <DrawerClose key={item.path} asChild>
              <NavLink to={item.path} icon={item.icon} onClick={handleNavClick} mobile>
                {item.label}
              </NavLink>
            </DrawerClose>
          ))}
        </nav>
        <div className="border-t p-4">
          <div className="flex items-center gap-3">
            <div className="flex size-12 min-h-[48px] min-w-[48px] items-center justify-center rounded-full bg-muted">
              <User className="size-6 text-muted-foreground" />
            </div>
            <div className="flex-1">
              <p className="font-medium">{name}</p>
              <p className="text-sm text-muted-foreground">{email}</p>
            </div>
          </div>
        </div>
      </DrawerContent>
    </Drawer>
  );
}

export function Layout({ children }: LayoutProps) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  return (
    <div className="min-h-screen bg-background">
      {/* Desktop Sidebar */}
      <DesktopSidebar />

      {/* Mobile Header */}
      <MobileHeader onMenuOpen={() => setMobileMenuOpen(true)} />

      {/* Mobile Menu */}
      <MobileMenu isOpen={mobileMenuOpen} onOpenChange={setMobileMenuOpen} />

      {/* Main Content */}
      <main className="lg:ml-64">
        <div className="min-h-screen pt-16 lg:pt-0">
          <div className="p-4 md:p-6 lg:p-8">{children}</div>
        </div>
      </main>
    </div>
  );
}
