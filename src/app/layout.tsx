import type { Metadata } from "next";
import { Geist } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "CheapPump.co.uk | Find the Cheapest Fuel Near You",
  description:
    "Compare UK petrol and diesel prices near you and find the cheapest fuel station fast.",
  keywords: ["cheap fuel", "petrol prices", "diesel prices", "UK fuel", "cheapest petrol"],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${geistSans.variable} h-full antialiased`}>
      <head>
        <script defer src="https://cloud.umami.is/script.js" data-website-id="5269359d-5a18-4af5-b4a7-1d245ff8e492" />
      </head>
      <body className="min-h-full flex flex-col font-sans">{children}</body>
    </html>
  );
}
