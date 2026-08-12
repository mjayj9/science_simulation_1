import type { Metadata } from "next";
import SimulatorClient from "@/src/ui/SimulatorClient";

export const metadata: Metadata = {
  title: "3D 태양광 시뮬레이터",
  description: "평면·정육면체·구·반구·원기둥·원뿔을 토지면적과 PV면적 기준으로 함께 비교하는 PC용 공학 시뮬레이터",
};

export default function Home() {
  return (
    <>
      <SimulatorClient />
      <noscript>이 시뮬레이터는 Three.js와 Web Worker 계산을 위해 JavaScript가 필요합니다.</noscript>
    </>
  );
}
