'use client';

import { useState, useEffect, useRef } from 'react';
import { toast } from 'sonner';
import { OdooInvoice } from '@isleno/types/odoo';

interface OcrRefreshStatus {
  isRunning: boolean;
  startTime?: Date;
  progress?: {
    completed: number;
    total: number;
  };
  lastResult?: {
    totalInvoices: number;
    successful: number;
    failed: number;
    duration: number;
    completedAt: string;
  };
  lastError?: string;
}

interface UseOcrStatusOptions {
  enabled?: boolean;
  pollingInterval?: number;
}

export function useOcrStatus(
  invoices?: OdooInvoice | OdooInvoice[],
  options: UseOcrStatusOptions = {}
) {
  const [status, setStatus] = useState<OcrRefreshStatus>({ isRunning: false });
  const [lastProcessedResult, setLastProcessedResult] = useState<string | null>(null);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const { enabled = true, pollingInterval = 2000 } = options;

  // Check if any invoices need OCR processing (null or zero amount_untaxed)
  const needsOcrProcessing = () => {
    if (!enabled || !invoices) return false;
    
    const invoiceArray = Array.isArray(invoices) ? invoices : [invoices];
    return invoiceArray.some(invoice => 
      invoice.amount_untaxed === null || 
      invoice.amount_untaxed === undefined || 
      invoice.amount_untaxed === 0
    );
  };

  const pollStatus = async () => {
    try {
      const response = await fetch('/api/invoices/ocr-status');
      if (!response.ok) return;
      
      const newStatus: OcrRefreshStatus = await response.json();
      setStatus(newStatus);

      // Check if we have a new completed result to show
      if (newStatus.lastResult && newStatus.lastResult.completedAt !== lastProcessedResult) {
        const result = newStatus.lastResult;
        const { successful, totalInvoices, failed, duration } = result;
        
        if (successful === totalInvoices) {
          toast.success('OCR Refresh Complete', {
            description: `Successfully refreshed ${successful} invoice${successful !== 1 ? 's' : ''} in ${Math.round(duration / 1000)}s`,
            duration: 5000
          });
        } else if (successful > 0) {
          toast.success('OCR Refresh Partially Complete', {
            description: `Refreshed ${successful}/${totalInvoices} invoices successfully. ${failed} failed.`,
            duration: 7000
          });
        } else {
          toast.error('OCR Refresh Failed', {
            description: `Failed to refresh ${totalInvoices} invoice${totalInvoices !== 1 ? 's' : ''}. Please try again.`,
            duration: 7000
          });
        }
        
        setLastProcessedResult(result.completedAt);
      }

      // Check if we have a new error to show
      if (newStatus.lastError && newStatus.lastError !== lastProcessedResult) {
        const error = newStatus.lastError;
        let title = 'OCR Refresh Error';
        let description = error;
        
        // Provide more specific error messages based on error content
        if (error.includes('Network error') || error.includes('fetch')) {
          title = 'Network Connection Error';
          description = 'Unable to connect to the OCR service. Please check your internet connection and try again.';
        } else if (error.includes('Authentication error') || error.includes('401')) {
          title = 'Authentication Error';
          description = 'Your session has expired. Please refresh the page and try again.';
        } else if (error.includes('Permission denied') || error.includes('403')) {
          title = 'Permission Denied';
          description = 'You do not have permission to perform OCR refresh operations.';
        } else if (error.includes('Service not found') || error.includes('404')) {
          title = 'Service Unavailable';
          description = 'The OCR service is not available. Please contact support.';
        } else if (error.includes('Server error') || error.includes('500')) {
          title = 'Server Error';
          description = 'The OCR service encountered an internal error. Please try again later.';
        } else if (error.includes('Service unavailable') || error.includes('502') || error.includes('503') || error.includes('504')) {
          title = 'Service Temporarily Unavailable';
          description = 'The OCR service is temporarily down. Please try again in a few minutes.';
        } else if (error.includes('timeout')) {
          title = 'Request Timeout';
          description = 'The OCR refresh operation took too long. Please try again.';
        } else if (error.includes('Odoo API')) {
          title = 'Odoo Service Error';
          description = 'Unable to communicate with the Odoo system. Please try again later.';
        }
        
        toast.error(title, {
          description,
          duration: 7000
        });
        
        setLastProcessedResult(error);
      }
    } catch (error) {
      console.error('Error polling OCR status:', error);
    }
  };

  useEffect(() => {
    // Only poll if explicitly enabled and invoices still need OCR processing
    if (!needsOcrProcessing()) {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      return;
    }

    // Start polling when enabled
    pollStatus();
    intervalRef.current = setInterval(pollStatus, pollingInterval);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [invoices, enabled, pollingInterval]); // Re-run when invoices or enablement state change

  // Update lastProcessedResult when status changes
  useEffect(() => {
    if (status.lastResult?.completedAt) {
      setLastProcessedResult(status.lastResult.completedAt);
    } else if (status.lastError) {
      setLastProcessedResult(status.lastError);
    }
  }, [status.lastResult?.completedAt, status.lastError]);

  return status;
}
