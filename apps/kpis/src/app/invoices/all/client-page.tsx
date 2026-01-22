'use client';

import { useState, useEffect } from 'react';
import { useTranslations } from 'next-intl';
import InvoiceTable from '@/components/InvoiceTable';
import { useOcrStatus } from '@/hooks/useOcrStatus';
import { OdooInvoice, PaginationInfo } from '@isleno/types/odoo';


export default function AllInvoicesClient() {
  const t = useTranslations('invoices.invoiceViews');
  const [invoices, setInvoices] = useState<OdooInvoice[]>([]);
  const [pagination, setPagination] = useState<PaginationInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [currentPage, setCurrentPage] = useState(1);
  const [zeroValueInvoiceIds, setZeroValueInvoiceIds] = useState<number[]>([]);
  
  // Use the OCR status hook for toast notifications
  useOcrStatus(invoices, { enabled: zeroValueInvoiceIds.length > 0 });

  const fetchInvoices = async (page: number = 1) => {
    try {
      setLoading(true);
      const response = await fetch(`/api/invoices?page=${page}&limit=20`);
      if (!response.ok) {
        throw new Error('Failed to fetch invoices');
      }
      
      const data = await response.json();
      setInvoices(data.invoices || []);
      setPagination(data.pagination || null);
      if (Array.isArray(data?.metadata?.zeroValueInvoiceIds)) {
        setZeroValueInvoiceIds(data.metadata.zeroValueInvoiceIds);
      } else {
        setZeroValueInvoiceIds([]);
      }
    } catch (error) {
      console.error('Error fetching invoices:', error);
      setZeroValueInvoiceIds([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchInvoices(currentPage);
  }, [currentPage]);

  const handlePageChange = (page: number) => {
    setCurrentPage(page);
  };

  return (
    <div className="container mx-auto py-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">
            {t('allInvoices')}
          </h1>
          <p className="text-muted-foreground">
            All invoices across all departments
          </p>
        </div>
      </div>

      {loading ? (
        <div className="text-center py-8">Loading invoices...</div>
      ) : (
        <InvoiceTable
          invoices={invoices}
          showDepartment={true}
          showAlias={true}
          title="All Invoices"
          description="All invoices across all departments with filtering options"
          pagination={pagination || undefined}
          onPageChange={handlePageChange}
        />
      )}
    </div>
  );
}
