"use client";

import { useState } from "react";
import { couFetch, couPay, getCouBillers } from "@/lib/client/api";
import type { BillPresentment, BillerSummary, PaymentMode } from "@/lib/domain/types";
import { BillersScreen, DetailsScreen, HomeScreen, type BillersState, type InlineResult, type RecentFetch } from "./Screens";
import { BillScreen, ReceiptScreen, type ReceiptView } from "./ResultScreens";
import { PaySheet } from "./PaySheet";
import { normaliseVehicle } from "./format";

type Screen = "home" | "billers" | "details" | "bill" | "receipt";

/** A payable bill and the NBBL fetch it came from. */
interface DueBill {
  bill: BillPresentment;
  fetchRef: string;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

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
    try {
      const r = await couFetch({ billerId: biller.id, vehicleNo: normaliseVehicle(vehicle), mobile });
      if (r.result !== "NOT_FOUND") setRecent({ biller, vehicle, mobile });
      if (r.result === "BILL_DUE") {
        setDue({ bill: r.bill, fetchRef: r.fetchRef });
        setScreen("bill");
      } else {
        setInline(r);
      }
    } catch {
      setFetchError("Something went wrong while fetching your bill. Try again.");
    } finally {
      setFetching(false);
    }
  }

  async function doPay(mode: PaymentMode, simulateFailure: boolean) {
    if (!due || paying) return;
    const amountPaise = due.bill.amountPaise;
    setPaying(true);
    try {
      const [res] = await Promise.all([couPay({ fetchRef: due.fetchRef, amountPaise, mode, simulateFailure }), sleep(800)]);
      setReceipt(
        res.status === "SUCCESS"
          ? { kind: "success", receipt: res.receipt, couOrderId: res.couOrderId }
          : { kind: "failed", message: res.message, couOrderId: res.couOrderId, amountPaise },
      );
    } catch {
      setReceipt({ kind: "failed", message: "We couldn't complete the payment. Try again.", amountPaise });
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
  if (screen === "home") content = <HomeScreen onEv={openEv} />;
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
    <div className="relative h-dvh w-full overflow-hidden bg-pay-canvas min-[480px]:h-[800px] min-[480px]:w-[390px] min-[480px]:rounded-[2rem] min-[480px]:border-8 min-[480px]:border-ink min-[480px]:shadow-card">
      {content}
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
