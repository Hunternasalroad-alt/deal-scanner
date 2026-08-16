import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Deal Scanner",
  description: "Trading card deal scanner",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
