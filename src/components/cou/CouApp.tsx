"use client";

import { useEffect, useState } from "react";
import { couFetch, couPay, getCouBillers } from "@/lib/client/api";
import type { BillPresentment, BillerSummary, PaymentMode } from "@/lib/domain/types";
import { BillersScreen, DetailsScreen, HomeScreen, type BillersState, type InlineResult, type RecentFetch } from "./Screens";
import { BillScreen, ReceiptScreen, type ReceiptView } from "./ResultScreens";
import { HelpScreen } from "./HelpScreens";
import { PaySheet } from "./PaySheet";
import { formatDate, normaliseVehicle } from "./format";
import { formatINR } from "@/lib/domain/money";

type Screen = "home" | "billers" | "details" | "bill" | "receipt" | "help";

/** A payable bill and the NBBL fetch it came from. */
interface DueBill {
  bill: BillPresentment;
  fetchRef: string;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const FRAME_H = 800;
// Site nav + disclaimer footer + page padding around the frame.
const CHROME_H = 120;

/** On screens ≥480px wide, the zoom that fits the 800px phone frame in the window (never above 1). */
function useFrameZoom(): number {
  const [zoom, setZoom] = useState(1);
  useEffect(() => {
    const fit = () =>
      setZoom(window.innerWidth < 480 ? 1 : Math.max(0.6, Math.min(1, (window.innerHeight - CHROME_H) / FRAME_H)));
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, []);
  return zoom;
}

export function CouApp() {
  const [screen, setScreen] = useState<Screen>("home");
  const [billers, setBillers] = useState<BillersState>({ status: "loading" });
  const [biller, setBiller] = useState<BillerSummary | null>(null);
  const [vehicle, setVehicle] = useState("");
  const [mobile, setMobile] = useState("");
  const [fetching, setFetching] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  // Paytm-style: every non-payable fetch result is shown inline on the details form.
  const [inline, setInline] = useState<InlineResult | null>(null);
  const [due, setDue] = useState<DueBill | null>(null);
  const [recent, setRecent] = useState<RecentFetch | null>(null);
  const [payOpen, setPayOpen] = useState(false);
  const [paying, setPaying] = useState(false);
  const [receipt, setReceipt] = useState<ReceiptView | null>(null);
  // One persistent live region: screen readers miss role="status" nodes that mount already filled.
  const [announce, setAnnounce] = useState("");
  const frameZoom = useFrameZoom();

  async function loadBillers() {
    setBillers({ status: "loading" });
    try {
      setBillers({ status: "ready", billers: await getCouBillers("EV_BAAS") });
    } catch {
      setBillers({ status: "error" });
    }
  }

  function openEv() {
    setScreen("billers");
    void loadBillers();
  }

  function openDetails(b: BillerSummary) {
    if (b.id !== biller?.id) setInline(null);
    setBiller(b);
    setFetchError(null);
    setScreen("details");
  }

  // Editing the form clears the previous inline answer.
  function editVehicle(v: string) {
    setVehicle(v);
    setInline(null);
  }
  function editMobile(m: string) {
    setMobile(m);
    setInline(null);
  }

  async function doFetch() {
    if (!biller || fetching) return;
    setFetching(true);
    setFetchError(null);
    setInline(null);
    setAnnounce("Fetching your bill");
    try {
      const r = await couFetch({ billerId: biller.id, vehicleNo: normaliseVehicle(vehicle), mobile });
      if (r.result !== "NOT_FOUND") setRecent({ biller, vehicle, mobile });
      setAnnounce(
        r.result === "BILL_DUE"
          ? `Bill found: ${formatINR(r.bill.amountPaise)} due ${formatDate(r.bill.dueDate)}`
          : r.result === "ALREADY_PAID"
            ? "No bill due. This bill is already paid."
            : r.result === "NOT_GENERATED"
              ? "Bill not generated yet."
              : r.result === "NOT_FOUND"
                ? "No account found for this vehicle and mobile."
                : "The biller isn't responding. Try again in a moment.",
      );
      if (r.result === "BILL_DUE") {
        setDue({ bill: r.bill, fetchRef: r.fetchRef });
        setScreen("bill");
      } else {
        setInline(r);
      }
    } catch {
      setAnnounce("");
      setFetchError("Something went wrong while fetching your bill. Try again.");
    } finally {
      setFetching(false);
    }
  }

  async function doPay(mode: PaymentMode, simulateFailure: boolean) {
    if (!due || paying) return;
    const amountPaise = due.bill.amountPaise;
    setPaying(true);
    setAnnounce("Processing payment");
    try {
      const [res] = await Promise.all([couPay({ fetchRef: due.fetchRef, amountPaise, mode, simulateFailure }), sleep(800)]);
      setReceipt(
        res.status === "SUCCESS"
          ? { kind: "success", receipt: res.receipt, couOrderId: res.couOrderId }
          : { kind: "failed", message: res.message, couOrderId: res.couOrderId, amountPaise },
      );
      setAnnounce(res.status === "SUCCESS" ? `Payment successful. ${formatINR(amountPaise)} paid.` : "Payment failed.");
    } catch {
      setReceipt({ kind: "failed", message: "We couldn't complete the payment. Try again.", amountPaise });
      setAnnounce("Payment failed.");
    } finally {
      setPaying(false);
      setPayOpen(false);
      setScreen("receipt");
    }
  }

  function done() {
    setReceipt(null);
    setDue(null);
    setInline(null);
    setFetchError(null);
    setScreen("details");
  }

  let content;
  if (screen === "home") content = <HomeScreen onEv={openEv} onHelp={() => setScreen("help")} />;
  else if (screen === "help") content = <HelpScreen onBack={() => setScreen("home")} />;
  else if (screen === "billers")
    content = (
      <BillersScreen
        state={billers}
        recent={recent}
        onBack={() => setScreen("home")}
        onRetry={loadBillers}
        onPick={openDetails}
        onPickRecent={(r) => {
          setVehicle(r.vehicle);
          setMobile(r.mobile);
          openDetails(r.biller);
        }}
      />
    );
  else if (screen === "details" && biller)
    content = (
      <DetailsScreen
        biller={biller}
        vehicle={vehicle}
        mobile={mobile}
        setVehicle={editVehicle}
        setMobile={editMobile}
        fetching={fetching}
        error={fetchError}
        inline={inline}
        onBack={() => setScreen("billers")}
        onFetch={doFetch}
        onViewReceipt={(r) => {
          setReceipt({ kind: "success", receipt: r });
          setScreen("receipt");
        }}
      />
    );
  else if (screen === "bill" && due)
    content = <BillScreen bill={due.bill} onBack={() => setScreen("details")} onPay={() => setPayOpen(true)} />;
  else if (screen === "receipt" && receipt)
    content = (
      <ReceiptScreen
        view={receipt}
        onDone={done}
        onRetry={
          receipt.kind === "failed" && due
            ? () => {
                setReceipt(null);
                setScreen("bill");
                setPayOpen(true);
              }
            : undefined
        }
      />
    );

  return (
    // Phone: full screen. Wider screens: a 390×800 phone frame, zoomed down evenly to fit the window.
    <div
      style={frameZoom < 1 ? { zoom: frameZoom } : undefined}
      className="relative h-dvh w-full overflow-hidden bg-pay-canvas min-[480px]:h-[800px] min-[480px]:w-[390px] min-[480px]:rounded-[2.5rem] min-[480px]:border-[10px] min-[480px]:border-ink min-[480px]:shadow-card"
    >
      {content}
      <p aria-live="polite" className="sr-only">
        {announce}
      </p>
      {payOpen && due && (
        <PaySheet
          amountPaise={due.bill.amountPaise}
          billerName={due.bill.billerName}
          paying={paying}
          onClose={() => setPayOpen(false)}
          onPay={doPay}
        />
      )}
    </div>
  );
}
