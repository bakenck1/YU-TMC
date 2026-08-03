"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { X } from "lucide-react";
import { useAppSettings } from "./AppSettingsProvider";
import {
  translateCampusBuilding,
  translateCampusBuildingDescription,
  type TranslationKey,
} from "@/lib/i18n";
import {
  buildQrMatrix,
  QR_SIZE,
  statusMeta,
  type CampusItem,
  type CampusStatus,
} from "@/lib/campus";
import type { CampusMapData } from "@/lib/campus-map-data";

// Parse a CSS declaration string into a React style object (keeps the
// high-fidelity prototype markup readable without hand-converting every prop).
function css(text: string): React.CSSProperties {
  const style: Record<string, string> = {};
  for (const part of text.split(";")) {
    const idx = part.indexOf(":");
    if (idx === -1) continue;
    const prop = part.slice(0, idx).trim();
    if (!prop) continue;
    const value = part.slice(idx + 1).trim();
    const camel = prop.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
    style[camel] = value;
  }
  return style as React.CSSProperties;
}

const STATUS_KEYS: Record<CampusStatus, { list: TranslationKey; card: TranslationKey }> = {
  ok: { list: "map.status.ok", card: "map.statusCard.ok" },
  check: { list: "map.status.check", card: "map.statusCard.check" },
  service: { list: "map.status.service", card: "map.statusCard.service" },
  writeoff: { list: "map.status.writeoff", card: "map.statusCard.writeoff" },
};

// Ground / decoration layers (behind the buildings).
const DECOR: string[] = [
  "position:absolute;left:0;top:0;width:100%;height:10px;background:#cde49e;",
  "position:absolute;left:0;top:10px;width:100%;height:22px;background:#e6e4db;",
  "position:absolute;left:0;bottom:0;width:100%;height:10px;background:#cde49e;",
  "position:absolute;left:0;bottom:10px;width:100%;height:22px;background:#e6e4db;",
  "position:absolute;left:33.44%;top:32px;width:26px;height:696px;background:#e7e5dc;",
  "position:absolute;left:75%;top:32px;width:26px;height:696px;background:#e7e5dc;",
  "position:absolute;left:0;top:500px;width:100%;height:26px;background:#e7e5dc;",
  "position:absolute;left:33.44%;top:208px;width:43.59%;height:20px;background:#ebe9e0;",
  "position:absolute;left:11.72%;top:445px;width:22.66%;height:18px;background:#ebe9e0;",
  "position:absolute;left:2.19%;top:90px;width:14.84%;height:345px;background:#eef4dc;border-radius:14px;",
  "position:absolute;left:3.91%;top:120px;width:60px;height:70px;background:#d7e9af;border-radius:45% 55% 50% 50%;",
  "position:absolute;left:4.69%;top:300px;width:70px;height:60px;background:#d7e9af;border-radius:55% 45% 50% 50%;",
  "position:absolute;left:5.47%;top:145px;width:13px;height:13px;border-radius:50%;background:radial-gradient(#8fbf6a,#6da34e);",
  "position:absolute;left:7.42%;top:175px;width:12px;height:12px;border-radius:50%;background:radial-gradient(#8fbf6a,#6da34e);",
  "position:absolute;left:4.3%;top:230px;width:13px;height:13px;border-radius:50%;background:radial-gradient(#8fbf6a,#6da34e);",
  "position:absolute;left:7.03%;top:330px;width:14px;height:14px;border-radius:50%;background:radial-gradient(#8fbf6a,#6da34e);",
  "position:absolute;left:4.69%;top:390px;width:12px;height:12px;border-radius:50%;background:radial-gradient(#8fbf6a,#6da34e);",
  "position:absolute;left:36.25%;top:236px;width:37.5%;height:270px;background:#f3f0e5;border:2px dashed #8ea9d6;border-radius:10px;",
  "position:absolute;left:39.06%;top:270px;width:90px;height:70px;background:#d3e7ab;border-radius:55% 45% 50% 60%;",
  "position:absolute;left:50%;top:300px;width:110px;height:80px;background:#d3e7ab;border-radius:45% 55% 60% 45%;",
  "position:absolute;left:59.38%;top:390px;width:80px;height:65px;background:#d3e7ab;border-radius:50% 60% 45% 55%;",
  "position:absolute;left:40.63%;top:400px;width:85px;height:60px;background:#d3e7ab;border-radius:60% 45% 55% 50%;",
  "position:absolute;left:41.41%;top:290px;width:13px;height:13px;border-radius:50%;background:radial-gradient(#8fbf6a,#6da34e);",
  "position:absolute;left:45.7%;top:315px;width:12px;height:12px;border-radius:50%;background:radial-gradient(#8fbf6a,#6da34e);",
  "position:absolute;left:52.73%;top:320px;width:14px;height:14px;border-radius:50%;background:radial-gradient(#8fbf6a,#6da34e);",
  "position:absolute;left:56.25%;top:345px;width:12px;height:12px;border-radius:50%;background:radial-gradient(#8fbf6a,#6da34e);",
  "position:absolute;left:61.72%;top:410px;width:13px;height:13px;border-radius:50%;background:radial-gradient(#8fbf6a,#6da34e);",
  "position:absolute;left:43.36%;top:425px;width:12px;height:12px;border-radius:50%;background:radial-gradient(#8fbf6a,#6da34e);",
  "position:absolute;left:48.44%;top:390px;width:12px;height:12px;border-radius:50%;background:radial-gradient(#8fbf6a,#6da34e);",
  "position:absolute;left:58.59%;top:280px;width:12px;height:12px;border-radius:50%;background:radial-gradient(#8fbf6a,#6da34e);",
  "position:absolute;left:41.41%;top:545px;width:60px;height:44px;background:#e5e2d7;border-radius:5px;",
  "position:absolute;left:68.75%;top:640px;width:56px;height:42px;background:#e5e2d7;border-radius:5px;",
];

interface BuildingCfg {
  id: string;
  wrap: string;
  hoverY: number;
  labelCss: string;
  labelGreen?: boolean;
  tooltipCss: string;
  selRing: string;
  shape: React.ReactNode;
}

const wing = (deg: number) => (
  <div key={deg} style={css(`position:absolute;left:116px;top:32px;width:48px;height:112px;transform-origin:50% 100%;transform:rotate(${deg}deg);`)}>
    <div style={css("position:absolute;inset:0;background:linear-gradient(135deg,#e4e4e1,#cfcfcb);border-radius:13px;box-shadow:0 8px 15px rgba(40,40,45,.16);")} />
    <div style={css("position:absolute;left:9px;right:9px;top:11px;bottom:11px;border:2px solid rgba(60,60,65,.09);border-radius:8px;")} />
  </div>
);

const BUILDINGS: BuildingCfg[] = [
  {
    id: "sports-complex",
    wrap: "position:absolute;left:88.28%;top:340px;width:110px;height:150px;",
    hoverY: 5,
    labelCss: "position:absolute;left:50%;top:-56px;transform:translateX(-50%);white-space:nowrap;background:#fff;color:#002060;font-weight:700;font-size:12px;padding:5px 11px;border-radius:9px;box-shadow:0 3px 9px rgba(20,40,25,.14);z-index:20;",
    tooltipCss: "position:absolute;left:50%;top:-94px;transform:translateX(-50%);",
    selRing: "position:absolute;left:-8px;right:-8px;top:-36px;bottom:-8px;border:3px solid #002060;border-radius:14px;box-shadow:0 0 0 5px rgba(0,32,96,.15);",
    shape: (
      <>
        <div style={css("position:absolute;left:7px;right:-8px;top:11px;bottom:-10px;background:rgba(70,60,35,.14);filter:blur(10px);border-radius:14px;")} />
        <div style={css("position:absolute;inset:0;background:linear-gradient(#cdbb92,#b09d73);border-radius:10px;")} />
        <div style={css("position:absolute;left:0;right:0;top:-28px;height:150px;background:linear-gradient(135deg,#eee2c6,#ddcda8);border-radius:10px;box-shadow:0 12px 20px rgba(60,50,25,.15);overflow:hidden;")}>
          <div style={css("position:absolute;inset:10px;border:2px solid rgba(130,120,90,.15);border-radius:6px;")} />
          <div style={css("position:absolute;left:0;right:0;top:0;bottom:0;display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:600;color:#9d8d68;")}>1/2</div>
        </div>
      </>
    ),
  },
  {
    id: "dormitory-2",
    wrap: "position:absolute;left:62.5%;top:560px;width:140px;height:130px;",
    hoverY: 5,
    labelCss: "position:absolute;left:50%;top:-56px;transform:translateX(-50%);white-space:nowrap;background:#fff;color:#002060;font-weight:700;font-size:12px;padding:5px 11px;border-radius:9px;box-shadow:0 3px 9px rgba(20,40,25,.14);z-index:20;",
    tooltipCss: "position:absolute;left:50%;top:-94px;transform:translateX(-50%);",
    selRing: "position:absolute;left:-8px;top:-38px;width:156px;height:178px;border:3px solid #002060;border-radius:12px;box-shadow:0 0 0 5px rgba(0,32,96,.15);",
    shape: (
      <>
        <div style={css("position:absolute;left:8px;right:-8px;top:12px;bottom:-9px;background:rgba(70,60,35,.14);filter:blur(10px);clip-path:polygon(58% 0,100% 0,100% 100%,0 100%,0 68%,58% 68%);")} />
        <div style={css("position:absolute;inset:0;background:linear-gradient(#d8cfb4,#c2b795);clip-path:polygon(58% 0,100% 0,100% 100%,0 100%,0 68%,58% 68%);")} />
        <div style={css("position:absolute;inset:0;transform:translateY(-30px);background:linear-gradient(135deg,#f7f3e7,#e9e1cb);clip-path:polygon(58% 0,100% 0,100% 100%,0 100%,0 68%,58% 68%);box-shadow:0 14px 22px rgba(60,50,25,.14);")}>
          <div style={css("position:absolute;left:6%;right:46%;bottom:14%;height:2px;background:rgba(130,120,90,.14);")} />
          <div style={css("position:absolute;left:79%;top:8%;bottom:40%;width:2px;background:rgba(130,120,90,.14);")} />
        </div>
      </>
    ),
  },
  {
    id: "main-campus",
    wrap: "position:absolute;left:8.59%;top:130px;width:280px;height:280px;",
    hoverY: 6,
    labelCss: "position:absolute;left:50%;top:34px;transform:translateX(-50%);white-space:nowrap;background:#fff;color:#002060;font-weight:700;font-size:12.5px;padding:5px 12px;border-radius:9px;box-shadow:0 3px 9px rgba(20,40,25,.14);z-index:20;",
    tooltipCss: "position:absolute;left:50%;top:-6px;transform:translateX(-50%);",
    selRing: "position:absolute;left:16px;top:6px;width:248px;height:268px;border:3px solid #002060;border-radius:22px;box-shadow:0 0 0 5px rgba(0,32,96,.15);",
    shape: (
      <>
        <div style={css("position:absolute;left:45px;top:55px;width:190px;height:180px;background:rgba(50,50,55,.16);filter:blur(16px);border-radius:45%;")} />
        {[10, 80, 150, 225, 295].map(wing)}
        <div style={css("position:absolute;left:108px;top:108px;width:64px;height:64px;background:linear-gradient(#b6b6b2,#a0a09b);border-radius:13px;")} />
        <div style={css("position:absolute;left:108px;top:74px;width:64px;height:64px;background:linear-gradient(135deg,#f0f0ed,#dededa);border-radius:13px;box-shadow:0 18px 30px rgba(40,40,45,.2);overflow:hidden;")}>
          <div style={css("position:absolute;inset:10px;border:2px solid rgba(60,60,65,.11);border-radius:7px;")} />
        </div>
      </>
    ),
  },
  {
    id: "kgise",
    // KGISE is located in the south-west part of the campus plan.
    wrap: "position:absolute;left:3.5%;top:555px;width:96px;height:84px;",
    hoverY: 5,
    labelCss: "position:absolute;left:0;top:-54px;white-space:nowrap;background:#fff;color:#002060;font-weight:700;font-size:12px;padding:5px 11px;border-radius:9px;box-shadow:0 3px 9px rgba(20,40,25,.14);z-index:20;",
    tooltipCss: "position:absolute;left:0;top:104px;",
    selRing: "position:absolute;left:-8px;right:-8px;top:-34px;bottom:-8px;border:3px solid #002060;border-radius:18px;box-shadow:0 0 0 5px rgba(0,32,96,.15);",
    shape: (
      <>
        <div style={css("position:absolute;left:6px;right:-8px;top:10px;bottom:-10px;background:rgba(70,60,35,.14);filter:blur(9px);border-radius:16px;")} />
        <div style={css("position:absolute;inset:0;background:linear-gradient(#d2c5a3,#bbaa82);border-radius:14px;")} />
        <div style={css("position:absolute;left:0;right:0;top:-26px;height:84px;background:linear-gradient(135deg,#f0e7d2,#e2d4b5);border-radius:14px;box-shadow:0 10px 18px rgba(60,50,25,.15);overflow:hidden;")}>
          <div style={css("position:absolute;inset:10px;border:2px solid rgba(130,120,90,.15);border-radius:8px;")} />
        </div>
      </>
    ),
  },
  {
    id: "yessenov-technopark",
    // The Technopark is positioned in the north-west block of the plan.
    wrap: "position:absolute;left:25.5%;top:58px;width:118px;height:82px;",
    hoverY: 5,
    labelCss: "position:absolute;left:50%;top:-54px;transform:translateX(-50%);white-space:nowrap;background:#fff;color:#002060;font-weight:700;font-size:12px;padding:5px 11px;border-radius:9px;box-shadow:0 3px 9px rgba(20,40,25,.14);z-index:20;",
    tooltipCss: "position:absolute;left:50%;top:104px;transform:translateX(-50%);",
    selRing: "position:absolute;left:-8px;right:-8px;top:-34px;bottom:-8px;border:3px solid #002060;border-radius:18px;box-shadow:0 0 0 5px rgba(0,32,96,.15);",
    shape: (
      <>
        <div style={css("position:absolute;left:7px;right:-8px;top:10px;bottom:-10px;background:rgba(70,60,35,.14);filter:blur(9px);border-radius:16px;")} />
        <div style={css("position:absolute;inset:0;background:linear-gradient(#c7d4df,#9cadbb);border-radius:14px;")} />
        <div style={css("position:absolute;left:0;right:0;top:-26px;height:82px;background:linear-gradient(135deg,#eef4f7,#d7e4eb);border-radius:14px;box-shadow:0 10px 18px rgba(60,80,90,.15);overflow:hidden;") }>
          <div style={css("position:absolute;inset:10px;border:2px solid rgba(70,90,105,.15);border-radius:8px;")} />
        </div>
      </>
    ),
  },
  {
    id: "dormitory-1",
    wrap: "position:absolute;left:47.66%;top:550px;width:140px;height:130px;",
    hoverY: 5,
    labelCss: "position:absolute;left:50%;top:-56px;transform:translateX(-50%);white-space:nowrap;background:#fff;color:#002060;font-weight:700;font-size:12px;padding:5px 11px;border-radius:9px;box-shadow:0 3px 9px rgba(20,40,25,.14);z-index:20;",
    tooltipCss: "position:absolute;left:50%;top:-94px;transform:translateX(-50%);",
    selRing: "position:absolute;left:-8px;top:-38px;width:156px;height:178px;border:3px solid #002060;border-radius:12px;box-shadow:0 0 0 5px rgba(0,32,96,.15);",
    shape: (
      <>
        <div style={css("position:absolute;left:8px;right:-8px;top:12px;bottom:-9px;background:rgba(70,60,35,.14);filter:blur(10px);clip-path:polygon(58% 0,100% 0,100% 100%,0 100%,0 68%,58% 68%);")} />
        <div style={css("position:absolute;inset:0;background:linear-gradient(#d8cfb4,#c2b795);clip-path:polygon(58% 0,100% 0,100% 100%,0 100%,0 68%,58% 68%);")} />
        <div style={css("position:absolute;inset:0;transform:translateY(-30px);background:linear-gradient(135deg,#f7f3e7,#e9e1cb);clip-path:polygon(58% 0,100% 0,100% 100%,0 100%,0 68%,58% 68%);box-shadow:0 14px 22px rgba(60,50,25,.14);")}>
          <div style={css("position:absolute;left:6%;right:46%;bottom:14%;height:2px;background:rgba(130,120,90,.14);")} />
          <div style={css("position:absolute;left:79%;top:8%;bottom:40%;width:2px;background:rgba(130,120,90,.14);")} />
        </div>
      </>
    ),
  },
  {
    id: "marine-academy",
    wrap: "position:absolute;left:80.47%;top:80px;width:95px;height:200px;",
    hoverY: 5,
    labelCss: "position:absolute;left:50%;top:-58px;transform:translateX(-50%);white-space:nowrap;background:#fff;color:#002060;font-weight:700;font-size:12px;padding:5px 11px;border-radius:9px;box-shadow:0 3px 9px rgba(20,40,25,.14);z-index:20;",
    tooltipCss: "position:absolute;left:50%;top:221px;transform:translateX(-50%);",
    selRing: "position:absolute;left:-8px;right:-8px;top:-38px;bottom:-8px;border:3px solid #002060;border-radius:12px;box-shadow:0 0 0 5px rgba(0,32,96,.15);",
    shape: (
      <>
        <div style={css("position:absolute;left:7px;right:-8px;top:12px;bottom:-11px;background:rgba(70,60,35,.15);filter:blur(10px);border-radius:12px;")} />
        <div style={css("position:absolute;inset:0;background:linear-gradient(#cdbb92,#b09d73);border-radius:8px;")} />
        <div style={css("position:absolute;left:0;right:0;top:-30px;height:200px;background:linear-gradient(135deg,#eee2c6,#ddcda8);border-radius:8px;box-shadow:0 13px 22px rgba(60,50,25,.15);overflow:hidden;")}>
          <div style={css("position:absolute;inset:10px;border:2px solid rgba(130,120,90,.14);border-radius:5px;")} />
          <div style={css("position:absolute;left:10px;right:10px;top:33%;height:2px;background:rgba(130,120,90,.12);")} />
          <div style={css("position:absolute;left:10px;right:10px;top:66%;height:2px;background:rgba(130,120,90,.12);")} />
        </div>
      </>
    ),
  },
  {
    id: "center-1",
    wrap: "position:absolute;left:39%;top:260px;width:96px;height:62px;",
    hoverY: 5,
    labelCss: "position:absolute;left:50%;top:-48px;transform:translateX(-50%);white-space:nowrap;background:#fff;color:#002060;font-weight:700;font-size:12px;padding:5px 11px;border-radius:9px;box-shadow:0 3px 9px rgba(20,40,25,.14);z-index:20;",
    tooltipCss: "position:absolute;left:50%;top:80px;transform:translateX(-50%);",
    selRing: "position:absolute;left:-8px;right:-8px;top:-30px;bottom:-8px;border:3px solid #002060;border-radius:14px;box-shadow:0 0 0 5px rgba(0,32,96,.15);",
    shape: (
      <>
        <div style={css("position:absolute;left:7px;right:-8px;top:10px;bottom:-10px;background:rgba(35,55,85,.16);filter:blur(9px);border-radius:12px;")} />
        <div style={css("position:absolute;inset:0;background:linear-gradient(#91a9bd,#718ba1);border-radius:10px;")} />
        <div style={css("position:absolute;left:0;right:0;top:-18px;height:62px;background:linear-gradient(135deg,#dce8f0,#bdd0de);border-radius:10px;box-shadow:0 10px 18px rgba(45,70,90,.18);overflow:hidden;")}>
          <div style={css("position:absolute;inset:9px;border:2px solid rgba(60,90,115,.16);border-radius:6px;")} />
          <div style={css("position:absolute;left:16px;right:16px;top:50%;height:2px;background:rgba(60,90,115,.12);")} />
        </div>
      </>
    ),
  },
  {
    id: "center-2",
    wrap: "position:absolute;left:59%;top:260px;width:120px;height:84px;",
    hoverY: 5,
    labelCss: "position:absolute;left:50%;top:-48px;transform:translateX(-50%);white-space:nowrap;background:#fff;color:#002060;font-weight:700;font-size:12px;padding:5px 11px;border-radius:9px;box-shadow:0 3px 9px rgba(20,40,25,.14);z-index:20;",
    tooltipCss: "position:absolute;left:50%;top:96px;transform:translateX(-50%);",
    selRing: "position:absolute;left:-8px;right:-8px;top:-30px;bottom:-8px;border:3px solid #002060;border-radius:14px;box-shadow:0 0 0 5px rgba(0,32,96,.15);",
    shape: (
      <>
        <div style={css("position:absolute;left:7px;right:-8px;top:10px;bottom:-10px;background:rgba(35,55,85,.16);filter:blur(9px);border-radius:50%;clip-path:ellipse(50% 50% at 50% 50%);")} />
        <div style={css("position:absolute;inset:0;background:linear-gradient(#91a9bd,#718ba1);border-radius:50%;clip-path:ellipse(50% 50% at 50% 50%);")} />
        <div style={css("position:absolute;left:0;right:0;top:-22px;height:84px;background:linear-gradient(135deg,#dce8f0,#bdd0de);border-radius:50%;box-shadow:0 10px 18px rgba(45,70,90,.18);overflow:hidden;clip-path:ellipse(50% 50% at 50% 50%);")}>
          <div style={css("position:absolute;inset:9px;border:2px solid rgba(60,90,115,.16);border-radius:50%;")} />
          <div style={css("position:absolute;left:16px;right:16px;top:50%;height:2px;background:rgba(60,90,115,.12);")} />
        </div>
        <div aria-hidden="true" style={css("position:absolute;left:43%;top:-8%;width:67%;height:86%;background:#f3f0e5;border-radius:50%;")} />
      </>
    ),
  },
  {
    id: "yessenov-stadium",
    wrap: "position:absolute;left:78.13%;top:530px;width:250px;height:180px;",
    hoverY: 4,
    labelCss: "position:absolute;left:50%;top:-42px;transform:translateX(-50%);white-space:nowrap;background:#fff;color:#002060;font-weight:700;font-size:12px;padding:5px 11px;border-radius:9px;box-shadow:0 3px 9px rgba(20,40,25,.14);z-index:20;",
    tooltipCss: "position:absolute;left:50%;top:-80px;transform:translateX(-50%);",
    selRing: "position:absolute;inset:-8px;border:3px solid #002060;border-radius:50%;box-shadow:0 0 0 5px rgba(0,32,96,.15);",
    shape: (
      <>
        <div style={css("position:absolute;left:8px;right:-8px;top:10px;bottom:-10px;background:rgba(55,80,35,.18);filter:blur(11px);border-radius:50%;")} />
        <div style={css("position:absolute;inset:0;background:#dce9bf;border:4px solid #87aa62;border-radius:50%;box-shadow:0 12px 20px rgba(55,80,35,.16);")} />
        <div style={css("position:absolute;inset:24px;background:#8fbf6a;border:3px solid #f2f0e6;border-radius:48%;")} />
        <div style={css("position:absolute;inset:43px;background:linear-gradient(90deg,#7fb45b,#91c66c);border-radius:46%;")} />
        <div style={css("position:absolute;left:50%;top:43px;bottom:43px;border-left:2px solid rgba(255,255,255,.7);")} />
      </>
    ),
  },
];

type DecorativeField = {
  id: string;
  kind: "basketball" | "football";
  left: string;
  top: number;
  width: number;
  height: number;
  label: TranslationKey;
};

const DECORATIVE_FIELDS: DecorativeField[] = [
  { id: "basketball-1", kind: "basketball", left: "72%", top: 74, width: 150, height: 88, label: "map.decorativeBasketball1" },
  { id: "basketball-2", kind: "basketball", left: "84%", top: 74, width: 150, height: 88, label: "map.decorativeBasketball2" },
  { id: "football-1", kind: "football", left: "72%", top: 178, width: 190, height: 105, label: "map.decorativeFootball1" },
  { id: "football-2", kind: "football", left: "84%", top: 178, width: 190, height: 105, label: "map.decorativeFootball2" },
];

type View = "loading" | "building" | "floor" | "item";

export default function CampusMap({ data }: { data: CampusMapData }) {
  const { dataLabel, language, t } = useAppSettings();
  const buildingLabel = useCallback(
    (name: string) => translateCampusBuilding(language, name),
    [language],
  );
  const buildingDescription = useCallback(
    (name: string, fallback: string) =>
      translateCampusBuildingDescription(language, name, fallback),
    [language],
  );
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [hovered, setHovered] = useState<string | null>(null);
  const [buildingId, setBuildingId] = useState<string | null>(null);
  const [floorN, setFloorN] = useState<number | null>(null);
  const [itemId, setItemId] = useState<string | null>(null);
  const [view, setView] = useState<View>("building");

  const modalOpen = buildingId != null;
  const loading = view === "loading";

  // Fit the 1280×760 canvas to the host (scales with height, stretches width).
  useEffect(() => {
    const host = hostRef.current;
    const canvas = canvasRef.current;
    if (!host || !canvas) return;
    const fit = () => {
      const w = host.clientWidth - 16;
      const h = host.clientHeight - 16;
      const sc = h / 760;
      canvas.style.transform = `scale(${sc})`;
      canvas.style.width = Math.max(1280, Math.floor(w / sc)) + "px";
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(host);
    window.addEventListener("resize", fit);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", fit);
    };
  }, []);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const openBuilding = useCallback((id: string) => {
    if (timer.current) clearTimeout(timer.current);
    setBuildingId(id);
    setFloorN(null);
    setItemId(null);
    setHovered(null);
    setView("loading");
    timer.current = setTimeout(() => setView("building"), 600);
  }, []);

  const openFloor = useCallback((n: number) => {
    if (timer.current) clearTimeout(timer.current);
    setView("loading");
    setItemId(null);
    timer.current = setTimeout(() => {
      setFloorN(n);
      setView("floor");
    }, 450);
  }, []);

  const openItem = useCallback((id: string) => {
    if (timer.current) clearTimeout(timer.current);
    setView("loading");
    timer.current = setTimeout(() => {
      setItemId(id);
      setView("item");
    }, 400);
  }, []);

  const close = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    setBuildingId(null);
    setFloorN(null);
    setItemId(null);
    setView("building");
  }, []);

  useEffect(() => {
    if (!modalOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [modalOpen, close]);

  const building = buildingId ? data.buildings[buildingId] : null;
  const item = itemId ? data.itemsById[itemId] : null;

  const crumbs = useMemo(() => {
    if (!building) return [];
    const list: {
      label: string;
      action?: "close" | "building" | { floor: number };
      active?: boolean;
    }[] = [
      { label: t("map.campus"), action: "close" },
    ];
    if (view === "building") {
      list.push({ label: buildingLabel(building.name), active: true });
    } else if (view === "floor" && floorN != null) {
      list.push({ label: buildingLabel(building.name), action: "building" });
      list.push({ label: t("map.floor", { n: floorN }), active: true });
    } else if (view === "item" && item) {
      list.push({ label: buildingLabel(building.name), action: "building" });
      list.push({
        label: t("map.floor", { n: item.floorN }),
        action: { floor: item.floorN },
      });
      list.push({ label: item.name, active: true });
    }
    return list;
  }, [building, buildingLabel, view, floorN, item, t]);

  const keyItems = useMemo(() => {
    if (!building) return [];
    return [...building.all]
      .sort((a, b) => (a.status !== "ok" ? 0 : 1) - (b.status !== "ok" ? 0 : 1))
      .slice(0, 6);
  }, [building]);

  const floor = view === "floor" && building && floorN != null
    ? building.floors.find((f) => f.n === floorN) ?? null
    : null;

  return (
    <div ref={hostRef} className="flex h-[600px] items-center justify-start overflow-hidden rounded-2xl border border-black/5 bg-white p-2 shadow-sm">
      <style>{`
        @keyframes campusSpin{to{transform:rotate(360deg);}}
        @keyframes campusFadeUp{from{opacity:0;transform:translateY(10px);}to{opacity:1;transform:translateY(0);}}
        @keyframes campusPulse{0%,100%{opacity:.5;}50%{opacity:1;}}
      `}</style>

      <div
        ref={canvasRef}
        style={css("position:relative;width:1280px;height:760px;flex:none;transform-origin:left center;border-radius:14px;overflow:hidden;background:#f7f6f1;")}
      >
        {DECOR.map((d, i) => (
          <div key={i} style={css(d)} />
        ))}
        <div style={css("position:absolute;left:37.81%;top:452px;font-size:11.5px;font-weight:700;color:#9aa392;letter-spacing:.04em;")}>{t("map.centralPark")}</div>
        <div style={css("position:absolute;left:42.19%;top:300px;width:220px;height:0;border-top:2px solid #e6e1d1;transform:rotate(14deg);")} />
        <div style={css("position:absolute;left:40.63%;top:420px;width:260px;height:0;border-top:2px solid #e6e1d1;transform:rotate(-10deg);")} />

        {/* T1 is a construction site, not an inventory building. Keep it
            outside BUILDINGS so it cannot open a building modal. */}
        <div
          id="t1-building"
          data-testid="t1-construction"
          aria-label={t("map.t1Construction")}
          style={css("position:absolute;left:35.5%;top:150px;width:150px;height:82px;pointer-events:none;z-index:3;")}
        >
          <div style={css("position:absolute;inset:0;background:repeating-linear-gradient(135deg,rgba(130,135,132,.28) 0,rgba(130,135,132,.28) 8px,rgba(160,164,160,.28) 8px,rgba(160,164,160,.28) 16px);background-color:rgba(112,118,115,.5);border:2px dashed #737a76;border-radius:8px;box-shadow:0 5px 12px rgba(35,45,40,.14);")} />
          <div style={css("position:absolute;inset:0;display:flex;align-items:center;justify-content:center;flex-direction:column;gap:3px;color:#4f5753;font-size:12px;font-weight:800;text-align:center;text-shadow:0 1px rgba(255,255,255,.45);")}>
            <span aria-hidden="true" style={{ fontSize: "23px", lineHeight: 1 }}>🏗️</span>
            <span>{t("map.t1Construction")}</span>
          </div>
        </div>

        {/* Decorative sports fields are visual context only, never inventory locations. */}
        {DECORATIVE_FIELDS.map((field) => (
          <div
            key={field.id}
            data-testid={`decorative-${field.id}`}
            aria-label={t(field.label)}
            style={{
              position: "absolute",
              left: field.left,
              top: field.top,
              width: field.width,
              height: field.height,
              pointerEvents: "none",
              // Auto stacking plus DOM order keeps fields behind later building overlays.
              borderRadius: field.kind === "football" ? "9px" : "5px",
              background:
                field.kind === "football"
                  ? "repeating-linear-gradient(90deg,rgba(255,255,255,.035) 0 12px,rgba(0,0,0,.035) 12px 24px),#5d9b62"
                  : "linear-gradient(135deg,rgba(255,255,255,.06),transparent 35%),#6d9bba",
              border: "2px solid rgba(255,255,255,.82)",
              boxShadow: "0 3px 8px rgba(35,55,40,.18)",
              overflow: "hidden",
            }}
          >
            {field.kind === "basketball" ? (
              <>
                <div aria-hidden="true" style={css("position:absolute;inset:7px;border:2px solid rgba(255,255,255,.88);box-shadow:inset 0 0 0 1px rgba(20,50,80,.18);")} />
                <div aria-hidden="true" style={css("position:absolute;left:50%;top:7px;bottom:7px;border-left:2px solid rgba(255,255,255,.88);")} />
                <div aria-hidden="true" style={css("position:absolute;left:50%;top:50%;width:25px;height:25px;transform:translate(-50%,-50%);border:2px solid rgba(255,255,255,.88);border-radius:50%;")} />
                <div aria-hidden="true" style={css("position:absolute;left:7px;top:50%;width:38px;height:52px;transform:translateY(-50%);border:2px solid rgba(255,255,255,.88);border-left:0;")} />
                <div aria-hidden="true" style={css("position:absolute;right:7px;top:50%;width:38px;height:52px;transform:translateY(-50%);border:2px solid rgba(255,255,255,.88);border-right:0;")} />
                <div aria-hidden="true" style={css("position:absolute;left:8px;top:50%;width:42px;height:62px;transform:translateY(-50%);border:2px solid rgba(255,255,255,.88);border-radius:0 50% 50% 0;clip-path:inset(0 0 0 50%);")} />
                <div aria-hidden="true" style={css("position:absolute;right:8px;top:50%;width:42px;height:62px;transform:translateY(-50%) rotate(180deg);border:2px solid rgba(255,255,255,.88);border-radius:0 50% 50% 0;clip-path:inset(0 0 0 50%);")} />
                <div aria-hidden="true" style={css("position:absolute;left:4px;top:50%;width:5px;height:22px;transform:translateY(-50%);background:#e8c66d;border:1px solid rgba(30,50,60,.35);border-radius:2px;")} />
                <div aria-hidden="true" style={css("position:absolute;right:4px;top:50%;width:5px;height:22px;transform:translateY(-50%);background:#e8c66d;border:1px solid rgba(30,50,60,.35);border-radius:2px;")} />
              </>
            ) : (
              <>
                <div aria-hidden="true" style={css("position:absolute;inset:8px;border:2px solid rgba(255,255,255,.86);box-shadow:inset 0 0 0 1px rgba(20,70,30,.22);")} />
                <div aria-hidden="true" style={css("position:absolute;left:50%;top:8px;bottom:8px;border-left:2px solid rgba(255,255,255,.86);")} />
                <div aria-hidden="true" style={css("position:absolute;left:50%;top:50%;width:28px;height:28px;transform:translate(-50%,-50%);border:2px solid rgba(255,255,255,.86);border-radius:50%;")} />
                <div aria-hidden="true" style={css("position:absolute;left:8px;top:24%;width:34px;height:52%;border:2px solid rgba(255,255,255,.86);border-left:0;")} />
                <div aria-hidden="true" style={css("position:absolute;right:8px;top:24%;width:34px;height:52%;border:2px solid rgba(255,255,255,.86);border-right:0;")} />
                <div aria-hidden="true" style={css("position:absolute;left:4px;top:39%;width:8px;height:22%;border:2px solid rgba(255,255,255,.86);border-left:0;")} />
                <div aria-hidden="true" style={css("position:absolute;right:4px;top:39%;width:8px;height:22%;border:2px solid rgba(255,255,255,.86);border-right:0;")} />
                <div aria-hidden="true" style={css("position:absolute;left:0;top:50%;width:5px;height:26px;transform:translateY(-50%);background:repeating-linear-gradient(0deg,#eef5e5 0 2px,transparent 2px 4px);border:1px solid rgba(255,255,255,.7);")} />
                <div aria-hidden="true" style={css("position:absolute;right:0;top:50%;width:5px;height:26px;transform:translateY(-50%);background:repeating-linear-gradient(0deg,#eef5e5 0 2px,transparent 2px 4px);border:1px solid rgba(255,255,255,.7);")} />
              </>
            )}
            <span style={css("position:absolute;left:6px;bottom:4px;color:#fff;font-size:10px;font-weight:800;text-shadow:0 1px 2px rgba(0,0,0,.4);")}>
              {t(field.label)}
            </span>
          </div>
        ))}

        {BUILDINGS.map((b) => {
          const buildingData = data.buildings[b.id];
          const isHovered = hovered === b.id;
          const isSelected = buildingId === b.id;
          return (
            <div
              key={b.id}
              onClick={() => openBuilding(b.id)}
              onMouseEnter={() => setHovered(b.id)}
              onMouseLeave={() => setHovered(null)}
              style={{
                ...css(b.wrap),
                cursor: "pointer",
                transition: "transform .18s",
                transform: isHovered ? `translateY(-${b.hoverY}px)` : undefined,
                zIndex: isHovered ? 40 : undefined,
              }}
            >
              {b.shape}
              {isSelected ? <div style={css(b.selRing)} /> : null}
              <div
                style={{
                  ...css(b.labelCss),
                  transition: "background .18s, color .18s",
                  ...(isHovered ? { background: "#002060", color: "#fff" } : {}),
                }}
              >
                {buildingLabel(buildingData.name)}
              </div>
              {isHovered ? (
                <div
                  style={{
                    ...css(b.tooltipCss),
                    whiteSpace: "nowrap",
                    background: "#12261c",
                    color: "#fff",
                    fontSize: "12px",
                    fontWeight: 600,
                    padding: "8px 12px",
                    borderRadius: "10px",
                    boxShadow: "0 8px 20px rgba(0,0,0,.25)",
                    zIndex: 30,
                  }}
                >
                  {t("map.tooltip", { name: buildingLabel(buildingData.name), count: buildingData.total })}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>

      {modalOpen ? (
        <div
          onClick={close}
          style={css("position:fixed;inset:0;z-index:100;background:rgba(18,32,22,.45);backdrop-filter:blur(3px);display:flex;align-items:center;justify-content:center;padding:32px;")}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ ...css("width:620px;max-width:94vw;max-height:90vh;background:#fbfcfb;border-radius:20px;box-shadow:0 40px 90px rgba(0,0,0,.4);display:flex;flex-direction:column;overflow:hidden;"), animation: "campusFadeUp .2s ease" }}
          >
            {/* header / breadcrumbs */}
            <div style={css("flex:none;display:flex;align-items:center;gap:12px;padding:15px 16px 15px 22px;border-bottom:1px solid #eef1ee;")}>
              <div style={css("flex:1;display:flex;align-items:center;flex-wrap:wrap;gap:2px;font-size:12.5px;")}>
                {crumbs.map((c, i) => (
                  <span key={i} style={{ display: "inline-flex", alignItems: "center" }}>
                    {i > 0 ? <span style={{ color: "#c0c9c3", margin: "0 4px" }}>›</span> : null}
                    {c.active ? (
                      <span style={{ fontWeight: 800, color: "#1c2420" }}>
                        {c.label}
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => {
                          if (c.action === "close") close();
                          else if (c.action === "building") setView("building");
                          else if (c.action) openFloor(c.action.floor);
                        }}
                        style={{
                          padding: 0,
                          border: 0,
                          background: "transparent",
                          font: "inherit",
                          fontWeight: 700,
                          color: "#002060",
                          cursor: "pointer",
                        }}
                      >
                        {c.label}
                      </button>
                    )}
                  </span>
                ))}
              </div>
              <button
                type="button"
                onClick={close}
                style={css("flex:none;width:32px;height:32px;border-radius:9px;background:#eef1ee;display:flex;align-items:center;justify-content:center;cursor:pointer;color:#6b7671;border:none;")}
              >
                <X size={18} />
              </button>
            </div>

            <div style={css("flex:1;overflow-y:auto;")}>
              {loading ? (
                <div style={css("min-height:340px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:18px;color:#8a948e;")}>
                  <div style={{ ...css("width:44px;height:44px;border:4px solid #e2ebe4;border-top-color:#002060;border-radius:50%;"), animation: "campusSpin .8s linear infinite" }} />
                  <div style={{ fontSize: "13.5px", fontWeight: 600, animation: "campusPulse 1.4s ease-in-out infinite" }}>{t("map.loading")}</div>
                </div>
              ) : null}

              {/* BUILDING */}
              {view === "building" && building ? (
                <div style={{ ...css("padding:22px 24px 34px;"), animation: "campusFadeUp .3s ease" }}>
                  <div style={css("font-size:12px;font-weight:700;color:#002060;letter-spacing:.06em;text-transform:uppercase;")}>{buildingDescription(building.name, building.sub)}</div>
                  <div style={css("font-size:24px;font-weight:800;letter-spacing:-.02em;margin-top:4px;")}>{buildingLabel(building.name)}</div>

                  <div style={css("display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;margin-top:20px;")}>
                    <div style={css("background:#fff;border:1px solid #eaefec;border-radius:14px;padding:15px;box-shadow:0 2px 6px rgba(20,40,25,.04);")}>
                      <div style={css("font-size:26px;font-weight:800;color:#1c2420;line-height:1;")}>{building.total}</div>
                      <div style={css("font-size:11.5px;color:#6b7671;font-weight:600;margin-top:6px;")}>{t("map.units")}</div>
                    </div>
                    <div style={css("background:#fff;border:1px solid #eaefec;border-radius:14px;padding:15px;box-shadow:0 2px 6px rgba(20,40,25,.04);")}>
                      <div style={css("font-size:26px;font-weight:800;color:#1c2420;line-height:1;")}>{building.floorCount}</div>
                      <div style={css("font-size:11.5px;color:#6b7671;font-weight:600;margin-top:6px;")}>{t("map.floors")}</div>
                    </div>
                    <div style={css("background:#fdf3e6;border:1px solid #f2ddc0;border-radius:14px;padding:15px;")}>
                      <div style={css("font-size:26px;font-weight:800;color:#c98a2b;line-height:1;")}>{building.attn}</div>
                      <div style={css("font-size:11.5px;color:#a97a2f;font-weight:600;margin-top:6px;")}>{t("map.needsAttention")}</div>
                    </div>
                  </div>

                  <div style={css("font-size:13px;font-weight:800;letter-spacing:.02em;margin:26px 0 12px;color:#3c463f;")}>{t("map.floorsHeading")}</div>
                  <div style={css("display:flex;flex-direction:column;gap:9px;")}>
                    {building.floors.map((f) => (
                      <div
                        key={f.n}
                        onClick={() => openFloor(f.n)}
                        style={css("display:flex;align-items:center;gap:14px;background:#fff;border:1px solid #eaefec;border-radius:13px;padding:13px 15px;cursor:pointer;box-shadow:0 1px 4px rgba(20,40,25,.03);")}
                      >
                        <div style={css("width:40px;height:40px;flex:none;border-radius:11px;background:#e6ecf7;color:#002060;font-weight:800;font-size:15px;display:flex;align-items:center;justify-content:center;")}>{f.n}</div>
                        <div style={css("flex:1;")}>
                          <div style={css("font-weight:700;font-size:14px;")}>{t("map.floor", { n: f.n })}</div>
                          <div style={css("font-size:12px;color:#6b7671;margin-top:2px;")}>{t("map.floorMeta", { units: f.units, rooms: f.roomCount })}</div>
                        </div>
                        {f.attn > 0 ? (
                          <div style={css("font-size:11px;font-weight:700;color:#c98a2b;background:#fdf3e6;border-radius:20px;padding:4px 9px;")}>{f.attn} ⚠</div>
                        ) : null}
                        <div style={css("color:#c0c9c3;font-size:18px;font-weight:700;")}>›</div>
                      </div>
                    ))}
                  </div>

                  <div style={css("font-size:13px;font-weight:800;letter-spacing:.02em;margin:26px 0 12px;color:#3c463f;")}>{t("map.keyItems")}</div>
                  <div style={css("display:flex;flex-direction:column;gap:8px;")}>
                    {keyItems.map((it) => {
                      const st = statusMeta(it.status);
                      return (
                        <div
                          key={it.id}
                          onClick={() => openItem(it.id)}
                          style={css("display:flex;align-items:center;gap:12px;background:#fff;border:1px solid #eaefec;border-radius:12px;padding:11px 14px;cursor:pointer;")}
                        >
                          <div style={css("flex:1;min-width:0;")}>
                            <div style={css("font-weight:600;font-size:13.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;")}>{it.name}</div>
                            <div style={css("font-size:11.5px;color:#8a948e;margin-top:2px;")}>{t("itemDetails.room")} {it.code}</div>
                          </div>
                          <div style={{ flex: "none", display: "flex", alignItems: "center", gap: "6px", fontSize: "11px", fontWeight: 700, padding: "4px 9px", borderRadius: "20px", color: st.color, background: st.bg }}>
                            <span style={{ width: "7px", height: "7px", borderRadius: "50%", background: st.color }} />
                            {t(STATUS_KEYS[it.status].list)}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  {keyItems.length === 0 ? (
                    <div style={css("margin-top:2px;border:1px dashed #d9e2dc;border-radius:12px;padding:14px;color:#6b7671;font-size:13px;")}>{t("map.emptyBuilding")}</div>
                  ) : null}
                </div>
              ) : null}

              {/* FLOOR */}
              {view === "floor" && floor && building ? (
                <div style={{ ...css("padding:22px 24px 34px;"), animation: "campusFadeUp .3s ease" }}>
                  <div style={css("font-size:24px;font-weight:800;letter-spacing:-.02em;")}>{t("map.floor", { n: floor.n })}</div>
                  <div style={css("font-size:13px;color:#6b7671;margin-top:4px;font-weight:600;")}>{t("map.floorUnits", { units: floor.units, rooms: floor.roomCount })}</div>

                  <div style={css("display:flex;flex-direction:column;gap:18px;margin-top:22px;")}>
                    {floor.rooms.map((r) => (
                      <div key={r.code} style={css("background:#fff;border:1px solid #eaefec;border-radius:15px;overflow:hidden;box-shadow:0 2px 6px rgba(20,40,25,.04);")}>
                        <div style={css("display:flex;align-items:center;gap:11px;padding:13px 16px;border-bottom:1px solid #f1f4f2;background:#f8faf8;")}>
                          <div style={css("font-weight:800;font-size:13px;color:#002060;background:#e6ecf7;border-radius:8px;padding:4px 9px;")}>{r.code}</div>
                          <div style={css("font-weight:700;font-size:14px;")}>{t("itemDetails.room")} {r.code}</div>
                          <div style={css("margin-left:auto;font-size:12px;color:#8a948e;font-weight:600;")}>{t("map.roomUnits", { count: r.items.length })}</div>
                        </div>
                        {r.items.map((it) => {
                          const st = statusMeta(it.status);
                          return (
                            <div
                              key={it.id}
                              onClick={() => openItem(it.id)}
                              style={css("display:flex;align-items:center;gap:12px;padding:12px 16px;cursor:pointer;border-top:1px solid #f4f6f4;")}
                            >
                              <div style={css("flex:1;min-width:0;")}>
                                <div style={css("font-weight:600;font-size:13.5px;")}>{it.name}</div>
                                <div style={css("font-size:11.5px;color:#8a948e;margin-top:2px;font-variant-numeric:tabular-nums;")}>{it.invNo} · {t("map.lastInv", { date: it.lastInv })}</div>
                              </div>
                              <div style={{ flex: "none", display: "flex", alignItems: "center", gap: "6px", fontSize: "11px", fontWeight: 700, padding: "4px 9px", borderRadius: "20px", color: st.color, background: st.bg }}>
                                <span style={{ width: "7px", height: "7px", borderRadius: "50%", background: st.color }} />
                                {t(STATUS_KEYS[it.status].list)}
                              </div>
                              <div style={css("color:#c8d0ca;font-size:16px;")}>›</div>
                            </div>
                          );
                        })}
                      </div>
                    ))}
                  </div>
                  {floor.rooms.length === 0 ? (
                    <div style={css("border:1px dashed #d9e2dc;border-radius:14px;padding:16px;color:#6b7671;font-size:13px;line-height:1.5;")}>{t("map.emptyFloor")}</div>
                  ) : null}
                </div>
              ) : null}

              {/* ITEM */}
              {view === "item" && item ? (
                <ItemCard item={item} buildingName={buildingLabel(building?.name ?? "")} t={t} category={dataLabel(item.category)} responsible={dataLabel(item.responsible)} />
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function ItemCard({
  item,
  buildingName,
  t,
  category,
  responsible,
}: {
  item: CampusItem;
  buildingName: string;
  t: ReturnType<typeof useAppSettings>["t"];
  category: string;
  responsible: string;
}) {
  const st = statusMeta(item.status);
  const qr = useMemo(() => buildQrMatrix(item.id), [item.id]);
  return (
    <div style={{ ...css("padding:22px 24px 40px;"), animation: "campusFadeUp .3s ease" }}>
      <div style={css("height:200px;border-radius:16px;background:repeating-linear-gradient(135deg,#eef1ef,#eef1ef 12px,#e3e9e5 12px,#e3e9e5 24px);display:flex;align-items:center;justify-content:center;border:1px solid #e6ebe7;")}>
        <span style={css("font-family:monospace;font-size:12px;color:#8a948e;letter-spacing:.08em;")}>{t("map.photo")}</span>
      </div>

      <div style={css("display:flex;align-items:flex-start;gap:14px;margin-top:18px;")}>
        <div style={css("flex:1;")}>
          <div style={css("font-size:12px;font-weight:700;color:#002060;letter-spacing:.05em;text-transform:uppercase;")}>{category}</div>
          <div style={css("font-size:21px;font-weight:800;letter-spacing:-.02em;margin-top:4px;line-height:1.2;")}>{item.name}</div>
          <div style={css("font-size:13px;color:#6b7671;margin-top:6px;font-variant-numeric:tabular-nums;font-weight:600;")}>{t("map.invNo", { no: item.invNo })}</div>
        </div>
        <div style={css("flex:none;text-align:center;")}>
          <div style={css("width:96px;height:96px;border-radius:12px;border:1px solid #e6ebe7;padding:7px;background:#fff;")}>
            <div style={{ display: "grid", gridTemplateColumns: `repeat(${QR_SIZE},1fr)`, gridTemplateRows: `repeat(${QR_SIZE},1fr)`, width: "100%", height: "100%" }}>
              {qr.map((on, i) => (
                <div key={i} style={{ background: on ? "#12261c" : "transparent" }} />
              ))}
            </div>
          </div>
          <div style={css("font-size:10px;color:#98a29c;margin-top:5px;font-weight:600;letter-spacing:.04em;")}>{t("map.scan")}</div>
        </div>
      </div>

      <div style={{ display: "inline-flex", alignItems: "center", gap: "7px", marginTop: "16px", fontSize: "12.5px", fontWeight: 700, padding: "7px 13px", borderRadius: "22px", color: st.color, background: st.bg }}>
        <span style={{ width: "8px", height: "8px", borderRadius: "50%", background: st.color }} />
        {t(STATUS_KEYS[item.status].card)}
      </div>

      <div style={css("display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:20px;")}>
        <div style={css("background:#fff;border:1px solid #eaefec;border-radius:13px;padding:14px;")}>
          <div style={css("font-size:11px;color:#8a948e;font-weight:700;letter-spacing:.03em;text-transform:uppercase;")}>{t("map.location")}</div>
          <div style={css("font-size:14px;font-weight:700;margin-top:5px;")}>{buildingName}, {t("map.roomShort")} {item.code}</div>
        </div>
        <div style={css("background:#fff;border:1px solid #eaefec;border-radius:13px;padding:14px;")}>
          <div style={css("font-size:11px;color:#8a948e;font-weight:700;letter-spacing:.03em;text-transform:uppercase;")}>{t("map.responsible")}</div>
          <div style={css("font-size:14px;font-weight:700;margin-top:5px;")}>{responsible}</div>
        </div>
      </div>

      <div style={css("font-size:13px;font-weight:800;margin:26px 0 4px;color:#3c463f;")}>{t("map.history")}</div>
      <div style={css("position:relative;padding-left:6px;margin-top:14px;")}>
        {item.history.map((h, i) => (
          <div key={i} style={css("position:relative;padding-left:26px;padding-bottom:20px;border-left:2px solid #e7ece8;margin-left:6px;")}>
            <div style={{ ...css("position:absolute;left:-7px;top:1px;width:12px;height:12px;border-radius:50%;border:2px solid #fbfcfb;"), background: h.dot }} />
            <div style={css("font-weight:700;font-size:13.5px;")}>{h.action}</div>
            <div style={css("font-size:12px;color:#6b7671;margin-top:3px;line-height:1.5;")}>{h.detail}</div>
            <div style={css("font-size:11.5px;color:#98a29c;margin-top:3px;font-variant-numeric:tabular-nums;")}>{h.date} · {h.who}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
