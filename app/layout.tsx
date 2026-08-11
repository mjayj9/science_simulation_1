import type { Metadata } from "next";
import { headers } from "next/headers";
import "./globals.css";

const title = "솔라폼 엔지니어링 랩";
const description =
  "태양·기상·열·회로·회전을 함께 계산하는 한국어 3D 태양광 공학 시뮬레이터";

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host") ?? "localhost:3000";
  const protocol = requestHeaders.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const metadataBase = new URL(`${protocol}://${host}`);

  return {
    metadataBase,
    title: {
      default: title,
      template: "%s · 솔라폼 랩",
    },
    description,
    applicationName: title,
    keywords: ["태양광", "3D 시뮬레이션", "PV", "Three.js", "발전량 비교"],
    openGraph: {
      type: "website",
      locale: "ko_KR",
      title,
      description,
      images: [{ url: "/solarform-continuous-og.png", width: 1536, height: 1024, alt: "솔라폼 연속 PV 스킨 형상 비교" }],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: ["/solarform-continuous-og.png"],
    },
  };
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
