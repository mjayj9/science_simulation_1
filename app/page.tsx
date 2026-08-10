import type { Metadata } from "next";
import SimulatorClient from "@/src/ui/SimulatorClient";

export const metadata: Metadata = {
  title: "3D 태양광 시뮬레이터",
  description: "20개 패널 형상, 날씨·음영·열·회로·인버터·회전을 함께 비교하는 PC용 공학 시뮬레이터",
};

export default function Home() {
  return (
    <>
      <SimulatorClient />
      <noscript>이 시뮬레이터는 Three.js와 Web Worker 계산을 위해 JavaScript가 필요합니다.</noscript>
    </>
  );
}
