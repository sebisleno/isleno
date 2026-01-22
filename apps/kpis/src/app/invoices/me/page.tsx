"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Check, RefreshCw } from "lucide-react";
import { useTranslations } from 'next-intl';
import { InvoiceCard } from "@/components/InvoiceCard";
import { useOcrRefreshStatus } from '@/hooks/useOcrRefreshStatus';
import { useOcrStatus } from '@/hooks/useOcrStatus';
import { OcrRefreshProgress } from '@/components/OcrRefreshProgress';
import { OdooInvoice, OdooSupplier } from '@isleno/types/odoo';





export default function InvoiceClientPage() {
  const t = useTranslations('invoices');
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [actionRequiredInvoices, setActionRequiredInvoices] = useState<OdooInvoice[]>([]);
  const [awaitingApprovalInvoices, setAwaitingApprovalInvoices] = useState<OdooInvoice[]>([]);
  const [sentForPaymentInvoices, setSentForPaymentInvoices] = useState<OdooInvoice[]>([]);
  const [paidInvoices, setPaidInvoices] = useState<OdooInvoice[]>([]);
  const [otherInvoices, setOtherInvoices] = useState<OdooInvoice[]>([]);
  const [suppliers, setSuppliers] = useState<OdooSupplier[]>([]);
  const [zeroValueInvoiceIds, setZeroValueInvoiceIds] = useState<number[]>([]);

  // OCR refresh status tracking
  const { status: ocrStatus, isComplete, hasUpdates } = useOcrRefreshStatus({
    zeroValueInvoiceIds,
    enabled: zeroValueInvoiceIds.length > 0,
    pollingInterval: 5000
  });

  // Combine all invoices for OCR status checking
  const allInvoices = [
    ...actionRequiredInvoices,
    ...awaitingApprovalInvoices,
    ...sentForPaymentInvoices,
    ...paidInvoices,
    ...otherInvoices
  ];

  const shouldTrackOcrStatus = zeroValueInvoiceIds.length > 0;

  // Use the new OCR status hook for toast notifications only when a refresh is in progress
  useOcrStatus(allInvoices, { enabled: shouldTrackOcrStatus });

  useEffect(() => {
    fetchInvoices();
    fetchSuppliers();
  }, []);

  const fetchInvoices = async () => {
    try {
      // For now, we'll use the existing endpoint and do client-side grouping
      // until we create the separate API routes
      const response = await fetch("/api/invoices");
      if (!response.ok) {
        throw new Error(`Failed to fetch invoices: ${response.status}`);
      }
      const data = await response.json();
      
      // Handle both old format (array) and new format (object with invoices property)
      const invoices = Array.isArray(data) ? data : data.invoices;
      
      // Log OCR refresh information if available
      if (!Array.isArray(data) && data.metadata) {
        if (process.env.NODE_ENV === 'development') {
          console.log('Invoice fetch metadata:', data.metadata);
          if (data.metadata.ocrRefreshPerformed) {
            console.log(`OCR refresh performed for ${data.metadata.zeroValueInvoicesRefreshed} invoices`);
          }
        }
        // Store zero-value invoice IDs for OCR refresh tracking
        if (Array.isArray(data.metadata.zeroValueInvoiceIds)) {
          setZeroValueInvoiceIds(data.metadata.zeroValueInvoiceIds);
        } else {
          setZeroValueInvoiceIds([]);
        }
      } else {
        setZeroValueInvoiceIds([]);
      }
      
      // Group invoices by status on the client side for now
      const actionRequired = invoices.filter((inv: OdooInvoice) => inv.x_studio_project_manager_review_status === 'pending');
      const awaitingApproval = invoices.filter((inv: OdooInvoice) => 
        inv.x_studio_project_manager_review_status === 'approved' && 
        inv.x_studio_is_over_budget === true
      );
      const sentForPayment = invoices.filter((inv: OdooInvoice) => inv.state === 'posted');
      const paid = invoices.filter((inv: OdooInvoice) => inv.state === 'paid');
      const other = invoices.filter((inv: OdooInvoice) => 
        inv.x_studio_project_manager_review_status !== 'pending' && 
        inv.x_studio_project_manager_review_status !== 'approved' && 
        inv.state !== 'posted' && 
        inv.state !== 'paid'
      );

      setActionRequiredInvoices(actionRequired);
      setAwaitingApprovalInvoices(awaitingApproval);
      setSentForPaymentInvoices(sentForPayment);
      setPaidInvoices(paid);
      setOtherInvoices(other);
    } catch (error) {
      console.error("Failed to fetch invoices:", error);
      setActionRequiredInvoices([]);
      setAwaitingApprovalInvoices([]);
      setSentForPaymentInvoices([]);
      setPaidInvoices([]);
      setOtherInvoices([]);
    } finally {
      setLoading(false);
    }
  };

  const fetchSuppliers = async () => {
    try {
      const response = await fetch("/api/odoo/suppliers");
      if (!response.ok) {
        throw new Error(`Failed to fetch suppliers: ${response.status}`);
      }
      const data = await response.json();
      setSuppliers(data);
    } catch (error) {
      console.error("Failed to fetch suppliers:", error);
      setSuppliers([]);
    }
  };

  // Helper function to check if an invoice is being refreshed
  const isInvoiceRefreshing = (invoiceId: number) => {
    return zeroValueInvoiceIds.includes(invoiceId) && !isComplete;
  };

  // Helper function to handle manual refresh
  const handleManualRefresh = async (invoiceId: number) => {
    try {
      const response = await fetch(`/api/invoices/${invoiceId}/refresh-ocr`, {
        method: 'POST'
      });
      
      if (response.ok) {
        // Add to zero value IDs to track refresh
        setZeroValueInvoiceIds(prev => [...new Set([...prev, invoiceId])]);
      } else {
        // Handle specific HTTP error responses
        let errorMessage = `Failed to refresh invoice ${invoiceId}`;
        
        try {
          const errorData = await response.json();
          if (errorData.error) {
            errorMessage = `${errorMessage}: ${errorData.error}`;
          }
          if (errorData.details) {
            errorMessage = `${errorMessage} (${errorData.details})`;
          }
        } catch (parseError) {
          errorMessage = `${errorMessage}: HTTP ${response.status} - ${response.statusText}`;
        }
        
        console.error(errorMessage);
        // You could also show a toast notification here if needed
      }
    } catch (error) {
      let errorMessage = 'Failed to refresh invoice';
      
      if (error instanceof Error) {
        if (error.name === 'TypeError' && error.message.includes('fetch')) {
          errorMessage = 'Network error: Unable to connect to the server. Please check your internet connection.';
        } else if (error.message.includes('timeout')) {
          errorMessage = 'Request timeout: The refresh operation took too long. Please try again.';
        } else {
          errorMessage = `${errorMessage}: ${error.message}`;
        }
      }
      
      console.error(errorMessage, {
        invoiceId,
        error,
        timestamp: new Date().toISOString()
      });
    }
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    await fetchInvoices();
    setRefreshing(false);
  };

  if (loading) {
    return (
      <div className="container mx-auto p-4">
        <div className="flex items-center justify-center h-64">
          <div className="text-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-4"></div>
            <p className="text-muted-foreground">{t('loadingInvoices')}</p>
          </div>
        </div>
      </div>
    );
  }

  const totalInvoices = actionRequiredInvoices.length + awaitingApprovalInvoices.length + sentForPaymentInvoices.length + paidInvoices.length + otherInvoices.length;
  const actionRequiredCount = actionRequiredInvoices.length;

  return (
    <div className="container mx-auto p-4 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">{t('myInvoices')}</h1>
          <p className="text-muted-foreground mt-1">
            {totalInvoices} total invoices • {actionRequiredCount} require action
          </p>
        </div>
        <Button 
          onClick={handleRefresh} 
          disabled={refreshing}
          variant="outline"
          size="sm"
        >
          <RefreshCw className={`h-4 w-4 mr-2 ${refreshing ? 'animate-spin' : ''}`} />
          {refreshing ? t('refreshing') : t('refresh')}
        </Button>
      </div>

      {/* OCR Refresh Progress */}
      <OcrRefreshProgress />

      {/* Invoice Groups */}
      <Accordion type="single" defaultValue="action_required" className="space-y-4">
        {/* Action Required */}
        <AccordionItem value="action_required" className="border rounded-lg">
          <AccordionTrigger className="px-6 py-4 hover:no-underline">
            <div className="flex items-center gap-3">
              <Badge variant="destructive" className="text-sm">
                {actionRequiredInvoices.length}
              </Badge>
              <span className="font-semibold text-lg">{t('actionRequired')}</span>
            </div>
          </AccordionTrigger>
          <AccordionContent className="px-6 pb-4">
            {actionRequiredInvoices.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <Check className="h-12 w-12 mx-auto mb-4 opacity-50" />
                <p>{t('allCaughtUp')}</p>
              </div>
            ) : (
              <div className="space-y-3">
                {actionRequiredInvoices.map((invoice: OdooInvoice) => (
                  <InvoiceCard 
                    key={invoice.id} 
                    invoice={invoice} 
                    isRefreshing={isInvoiceRefreshing(invoice.id)}
                    onRefresh={() => handleManualRefresh(invoice.id)}
                    onClick={() => router.push(`/invoices/${invoice.id}`)}
                  />
                ))}
              </div>
            )}
          </AccordionContent>
        </AccordionItem>

        {/* Awaiting Approval */}
        <AccordionItem value="awaiting_approval" className="border rounded-lg">
          <AccordionTrigger className="px-6 py-4 hover:no-underline">
            <div className="flex items-center gap-3">
              <Badge variant="secondary" className="text-sm">
                {awaitingApprovalInvoices.length}
              </Badge>
              <span className="font-semibold text-lg">{t('awaitingApproval')}</span>
            </div>
          </AccordionTrigger>
          <AccordionContent className="px-6 pb-4">
            {awaitingApprovalInvoices.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <p>{t('noInvoicesAwaitingApproval')}</p>
              </div>
            ) : (
              <div className="space-y-3">
                {awaitingApprovalInvoices.map((invoice: OdooInvoice) => (
                  <InvoiceCard 
                    key={invoice.id} 
                    invoice={invoice} 
                    isRefreshing={isInvoiceRefreshing(invoice.id)}
                    onRefresh={() => handleManualRefresh(invoice.id)}
                    onClick={() => router.push(`/invoices/${invoice.id}`)}
                  />
                ))}
              </div>
            )}
          </AccordionContent>
        </AccordionItem>

        {/* Sent for Payment */}
        <AccordionItem value="sent_for_payment" className="border rounded-lg">
          <AccordionTrigger className="px-6 py-4 hover:no-underline">
            <div className="flex items-center gap-3">
              <Badge variant="default" className="text-sm">
                {sentForPaymentInvoices.length}
              </Badge>
              <span className="font-semibold text-lg">{t('sentForPayment')}</span>
            </div>
          </AccordionTrigger>
          <AccordionContent className="px-6 pb-4">
            {sentForPaymentInvoices.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <p>{t('noInvoicesSentForPayment')}</p>
              </div>
            ) : (
              <div className="space-y-3">
                {sentForPaymentInvoices.map((invoice: OdooInvoice) => (
                  <InvoiceCard 
                    key={invoice.id} 
                    invoice={invoice} 
                    isRefreshing={isInvoiceRefreshing(invoice.id)}
                    onRefresh={() => handleManualRefresh(invoice.id)}
                    onClick={() => router.push(`/invoices/${invoice.id}`)}
                  />
                ))}
              </div>
            )}
          </AccordionContent>
        </AccordionItem>

        {/* Paid */}
        <AccordionItem value="paid" className="border rounded-lg">
          <AccordionTrigger className="px-6 py-4 hover:no-underline">
            <div className="flex items-center gap-3">
              <Badge variant="default" className="text-sm">
                {paidInvoices.length}
              </Badge>
              <span className="font-semibold text-lg">{t('paid')}</span>
            </div>
          </AccordionTrigger>
          <AccordionContent className="px-6 pb-4">
            {paidInvoices.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <p>{t('noPaidInvoices')}</p>
              </div>
            ) : (
              <div className="space-y-3">
                {paidInvoices.map((invoice: OdooInvoice) => (
                  <InvoiceCard 
                    key={invoice.id} 
                    invoice={invoice} 
                    isRefreshing={isInvoiceRefreshing(invoice.id)}
                    onRefresh={() => handleManualRefresh(invoice.id)}
                    onClick={() => router.push(`/invoices/${invoice.id}`)}
                  />
                ))}
              </div>
            )}
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    </div>
  );
}
