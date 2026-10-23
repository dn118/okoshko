import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Окошко — запись без пустых часов",
  description: "Сервис онлайн-записи и заполнения освободившихся мест для бизнеса по расписанию. Первый MVP — барбершоп.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ru">
      <body className="antialiased">{children}</body>
    </html>
  );
}
