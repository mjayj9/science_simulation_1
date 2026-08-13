import type { Metadata } from "next";
import { headers } from "next/headers";
import "./globals.css";

const title = "솔라폼 엔지니어링 랩";
const description =
  "동일한 토지 투영면적 A_land에서 여섯 단일 연속 PV 형상의 광학·열·연간 발전량을 비교하는 한국어 3D 공학 시뮬레이터";

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
    keywords: ["태양광", "토지면적", "3D 시뮬레이션", "PV", "Three.js", "발전량 비교"],
    openGraph: {
      type: "website",
      locale: "ko_KR",
      title,
      description,
      images: [{ url: "/solarform-fair-pv-og.png", width: 1672, height: 941, alt: "동일 토지면적 위 여섯 연속 PV 형상의 광학·열·회전 비교" }],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: ["/solarform-fair-pv-og.png"],
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
