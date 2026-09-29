"use client";

import { useState } from "react";
import { couFetch, couPay, getCouBillers } from "@/lib/client/api";
import type { BillerSummary, FetchResult, PaymentMode } from "@/lib/domain/types";
import { BillersScreen, DetailsScreen, HomeScreen, type BillersState } from "./Screens";
import { ReceiptScreen, ResultScreen, type ReceiptView } from "./ResultScreens";
import { PaySheet } from "./PaySheet";
import { normaliseVehicle } from "./format";

type Screen = "home" | "billers" | "details" | "result" | "receipt";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function CouApp() {
  const [screen, setScreen] = useState<Screen>("home");
  const [billers, setBillers] = useState<BillersState>({ status: "loading" });
  const [biller, setBiller] = useState<BillerSummary | null>(null);
  const [vehicle, setVehicle] = useState("");
  const [mobile, setMobile] = useState("");
  const [fetching, setFetching] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [result, setResult] = useState<FetchResult | null>(null);
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

  async function doFetch() {
    if (!biller || fetching) return;
    setFetching(true);
    setFetchError(null);
    try {
      const r = await couFetch({ billerId: biller.id, vehicleNo: normaliseVehicle(vehicle), mobile });
      setResult(r);
      setScreen("result");
    } catch {
      if (screen === "result") {
        setResult({ result: "BILLER_UNAVAILABLE", billerId: biller.id, billerName: biller.name, fetchRef: "", responseCode: "SYS500", message: "Biller unavailable" });
      } else {
        setFetchError("Something went wrong while fetching your bill. Please try again.");
      }
    } finally {
      setFetching(false);
    }
  }

  async function doPay(mode: PaymentMode, simulateFailure: boolean) {
    if (!result || result.result !== "BILL_DUE" || paying) return;
    const amountPaise = result.bill.amountPaise;
    setPaying(true);
    try {
      const [res] = await Promise.all([
        couPay({ fetchRef: result.fetchRef, amountPaise, mode, simulateFailure }),
        sleep(800),
      ]);
      setReceipt(
        res.status === "SUCCESS"
          ? { kind: "success", receipt: res.receipt, couOrderId: res.couOrderId }
          : { kind: "failed", message: res.message, couOrderId: res.couOrderId, amountPaise },
      );
    } catch {
      setReceipt({
        kind: "failed",
        message: "We couldn't complete the payment. Please try again.",
        amountPaise,
      });
    } finally {
      setPaying(false);
      setPayOpen(false);
      setScreen("receipt");
    }
  }

  function done() {
    setReceipt(null);
    setResult(null);
    setFetchError(null);
    setScreen("details");
  }

  let content;
  if (screen === "home") content = <HomeScreen onEv={openEv} />;
  else if (screen === "billers")
    content = (
      <BillersScreen
        state={billers}
        onBack={() => setScreen("home")}
        onRetry={loadBillers}
        onPick={(b) => {
          setBiller(b);
          setFetchError(null);
          setScreen("details");
        }}
      />
    );
  else if (screen === "details" && biller)
    content = (
      <DetailsScreen
        biller={biller}
        vehicle={vehicle}
        mobile={mobile}
        setVehicle={setVehicle}
        setMobile={setMobile}
        fetching={fetching}
        error={fetchError}
        onBack={() => setScreen("billers")}
        onFetch={doFetch}
      />
    );
  else if (screen === "result" && result)
    content = (
      <ResultScreen
        result={result}
        vehicle={vehicle}
        refetching={fetching}
        onBack={() => setScreen("details")}
        onPay={() => setPayOpen(true)}
        onRefetch={doFetch}
        onViewReceipt={(r) => {
          setReceipt({ kind: "success", receipt: r });
          setScreen("receipt");
        }}
      />
    );
  else if (screen === "receipt" && receipt)
    content = (
      <ReceiptScreen
        view={receipt}
        onDone={done}
        onRetry={
          receipt.kind === "failed"
            ? () => {
                setReceipt(null);
                setScreen("result");
                setPayOpen(true);
              }
            : undefined
        }
      />
    );

  return (
    <div className="relative h-dvh w-full overflow-hidden bg-canvas min-[480px]:h-[800px] min-[480px]:w-[390px] min-[480px]:rounded-[2rem] min-[480px]:border-8 min-[480px]:border-ink min-[480px]:shadow-card">
      {content}
      {payOpen && result?.result === "BILL_DUE" && (
        <PaySheet
          amountPaise={result.bill.amountPaise}
          billerName={result.bill.billerName}
          paying={paying}
          onClose={() => setPayOpen(false)}
          onPay={doPay}
        />
      )}
    </div>
  );
}
