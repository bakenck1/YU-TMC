import type { Metadata } from "next";
import { Geist, Geist_Mono, Montserrat } from "next/font/google";
import AppShell from "@/components/AppShell";
import AppSettingsProvider from "@/components/AppSettingsProvider";
import AuthProvider from "@/components/AuthProvider";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const montserrat = Montserrat({
  variable: "--font-montserrat",
  subsets: ["latin", "cyrillic"],
  weight: ["600", "700"],
});

export const metadata: Metadata = {
  title: "YU Inventory",
  description: "Университеттің тауарлық-материалдық құндылықтарын есепке алу жүйесі",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="kk"
      className={`${geistSans.variable} ${geistMono.variable} ${montserrat.variable} h-full antialiased`}
    >
      <body className="h-full">
        <AppSettingsProvider>
          <AuthProvider>
            <AppShell>{children}</AppShell>
          </AuthProvider>
        </AppSettingsProvider>
      </body>
    </html>
  );
}
