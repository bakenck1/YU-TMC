import type { Metadata, Viewport } from "next";
import AppShell from "@/components/AppShell";
import AppSettingsProvider from "@/components/AppSettingsProvider";
import AuthProvider from "@/components/AuthProvider";
import PwaRegistration from "@/components/PwaRegistration";
import "./globals.css";

export const metadata: Metadata = {
  title: "YU Inventory",
  description: "Система учёта товарно-материальных ценностей университета",
  applicationName: "YU Inventory",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "YU Inventory",
  },
  icons: {
    apple: [{ url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" }],
  },
};

export const viewport: Viewport = {
  themeColor: "#002060",
  colorScheme: "light",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="ru"
      className="h-full antialiased"
    >
      <body className="h-full" suppressHydrationWarning>
        <PwaRegistration />
        <AppSettingsProvider>
          <AuthProvider>
            <AppShell>{children}</AppShell>
          </AuthProvider>
        </AppSettingsProvider>
      </body>
    </html>
  );
}
