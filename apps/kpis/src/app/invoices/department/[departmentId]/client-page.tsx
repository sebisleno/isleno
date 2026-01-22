'use client';

import { useState, useEffect } from 'react';
import { useTranslations } from 'next-intl';
import InvoiceTable from '@/components/InvoiceTable';
import { useOcrStatus } from '@/hooks/useOcrStatus';
import { OdooInvoice, PaginationInfo } from '@isleno/types/odoo';

interface DepartmentInvoicesClientProps {
  departmentName: string;
  departmentId: string;
}


export default function DepartmentInvoicesClient({ 
  departmentName, 
  departmentId 
}: DepartmentInvoicesClientProps) {
  const t = useTranslations('invoices.invoiceViews');
  const tOptions = useTranslations('invoices.invoiceOptions');
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
            {departmentName} {t('departmentInvoices')}
          </h1>
          <p className="text-muted-foreground">
            {tOptions('viewDepartmentInvoicesFrom', { departmentName })}
          </p>
        </div>
      </div>

      {loading ? (
        <div className="text-center py-8">{tOptions('loadingInvoices')}</div>
      ) : (
        <InvoiceTable
          invoices={invoices}
          showAlias={true}
          title={`${departmentName} ${t('departmentInvoices')}`}
          description={tOptions('viewDepartmentInvoicesFrom', { departmentName })}
          pagination={pagination || undefined}
          onPageChange={handlePageChange}
        />
      )}
    </div>
  );
}
