"use client";

import { useEffect, useState, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { ArrowLeft, Eye, Check, Calendar, DollarSign, Building2, Tag } from "lucide-react";
import { useTranslations } from 'next-intl';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { getStatusBadgeInfo } from '@/lib/utils/invoiceUtils';
import { OdooInvoice, OdooInvoiceAttachment } from '@isleno/types/odoo';
import { OdooSupplier, OdooProject, OdooSpendCategory } from '@isleno/types/odoo';
import { BudgetImpactCard } from '@/components/BudgetImpactCard';
import { useBudget } from '@/contexts/BudgetContext';



export default function InvoiceDetailPage() {
  const t = useTranslations('invoices');
  const params = useParams();
  const router = useRouter();
  const invoiceId = params.invoice_id as string;
  const { profile, isLoading: userLoading } = useCurrentUser();
  const { addApprovedInvoice, isInvoiceApproved: isInvoiceApprovedInSession } = useBudget();
  const DEPARTMENT_IDENTIFIERS = ["Department","Departmento"];
  const PROJECT_IDENTIFIERS = ["Project","Proyecto"];
  const CONSTRUCTION_DEPT_ID = 17;
  
  const [invoice, setInvoice] = useState<OdooInvoice | null>(null);
  const [suppliers, setSuppliers] = useState<OdooSupplier[]>([]);
  const [projects, setProjects] = useState<OdooProject[]>([]);
  const [spendCategories, setSpendCategory] = useState<OdooSpendCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedDepartment, setSelectedDepartment] = useState<OdooProject | null>(null);
  const [selectedProject, setSelectedProject] = useState<OdooProject | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<string>('');
  const [hasExternalBasicPermission, setHasExternalBasicPermission] = useState(false);
  const [isPdfModalOpen, setIsPdfModalOpen] = useState(false);
  const [showJustificationModal, setShowJustificationModal] = useState(false);
  const [justificationText, setJustificationText] = useState('');
  const [budgetImpact, setBudgetImpact] = useState<any>(null);
  const hasAttemptedPopulate = useRef(false);

  useEffect(() => {
    if (invoiceId) {
      fetchInvoice();
      fetchSuppliers();
      fetchProjects();
      fetchSpendCategories();
      checkPermissions();
    }
  }, [invoiceId]);

  // Pre-populate department and project based on invoice's analytic distribution from Odoo
  useEffect(() => {
    const prePopulateFromAnalyticDistribution = async () => {
      // Only run if we have invoice data with line items, projects loaded, and haven't attempted yet
      if (invoice && projects.length > 0 && !hasAttemptedPopulate.current) {
        hasAttemptedPopulate.current = true;

        // Get analytic distribution from invoice line items
        const lineItems = (invoice as any).line_items || [];
        const analyticIds: number[] = [];

        // Collect all analytic account IDs from line items
        for (const lineItem of lineItems) {
          if (lineItem.analytic_distribution) {
            const ids = Object.keys(lineItem.analytic_distribution).map(id => parseInt(id));
            analyticIds.push(...ids);
          }
        }

        // Remove duplicates
        const uniqueAnalyticIds = [...new Set(analyticIds)];

        if (uniqueAnalyticIds.length > 0) {
          // Find department (where plan_id[1] is "Department" or "Departmento")
          const departmentProject = projects.find(p =>
            uniqueAnalyticIds.includes(p.id) &&
            p.plan_id &&
            DEPARTMENT_IDENTIFIERS.includes(p.plan_id[1])
          );

          if (departmentProject) {
            setSelectedDepartment(departmentProject);
            console.log('Auto-selected department from Odoo:', departmentProject.name);
          }

          // Find project (where plan_id[1] is "Project" or "Proyecto")
          const constructionProject = projects.find(p =>
            uniqueAnalyticIds.includes(p.id) &&
            p.plan_id &&
            PROJECT_IDENTIFIERS.includes(p.plan_id[1])
          );

          if (constructionProject) {
            setSelectedProject(constructionProject);
            console.log('Auto-selected project from Odoo:', constructionProject.name);
          }
        }
      }
    };

    prePopulateFromAnalyticDistribution();
  }, [invoice, projects, loading]);

  const fetchInvoice = async () => {
    try {
      const response = await fetch(`/api/invoices/${invoiceId}`);
      if (!response.ok) {
        throw new Error(`Failed to fetch invoice: ${response.status}`);
      }
      const data = await response.json();
      setInvoice(data);
    } catch (error) {
      console.error("Failed to fetch invoice:", error);
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

  const fetchProjects = async () => {
    try {
      console.log("🔍 Fetching projects from /api/odoo/projects...");
      const response = await fetch("/api/odoo/projects");
      console.log("📡 Projects API response status:", response.status);
      
      if (!response.ok) {
        const errorText = await response.text();
        console.error("❌ Projects API failed:", response.status, errorText);
        throw new Error(`Failed to fetch projects: ${response.status}`);
      }
      
      const data = await response.json();
      console.log("✅ Projects data received:", {
        count: Array.isArray(data) ? data.length : 'not array',
        sample: Array.isArray(data) && data.length > 0 ? data[0] : 'no data',
        isError: data.error ? true : false
      });
      
      if (data.error) {
        console.error("❌ Projects API returned error:", data.error);
        throw new Error(data.error);
      }
      
      setProjects(data);
      
      // Log department filtering
      const departments = data.filter((p: any) => p.plan_id && DEPARTMENT_IDENTIFIERS.includes(p.plan_id[1]));
      console.log("🏢 Department projects found:", {
        total: data.length,
        departments: departments.length,
        departmentNames: departments.map((d: any) => d.name)
      });
      
    } catch (error) {
      console.error("❌ Failed to fetch projects:", error);
      setProjects([]);
    }
  };

  const fetchSpendCategories = async () => {
    try {
      const response = await fetch("/api/odoo/spend-categories");
      if (!response.ok) {
        throw new Error(`Failed to fetch spend categories: ${response.status}`);
      }
      const data = await response.json();
      setSpendCategory(data);
    } catch (error) {
      console.error("Failed to fetch spend categories:", error);
      setSpendCategory([]);
    }
  };

  const checkPermissions = async () => {
    try {
      console.log("🔐 Checking external_basic permission...");
      const response = await fetch("/api/auth/check-external-basic");
      console.log("📡 Permission API response status:", response.status);
      
      if (!response.ok) {
        const errorText = await response.text();
        console.error("❌ Permission API failed:", response.status, errorText);
        setHasExternalBasicPermission(false);
        return;
      }
      
      const data = await response.json();
      console.log("✅ Permission check result:", data);
      setHasExternalBasicPermission(data.hasPermission);
    } catch (error) {
      console.error("❌ Failed to check permissions:", error);
      setHasExternalBasicPermission(false);
    }
  };



  const handleApprove = async () => {
    if (!invoice) return;

    // Check if budget impact shows over budget
    if (budgetImpact && budgetImpact.willBeOverBudget) {
      setShowJustificationModal(true);
      return;
    }

    await performApproval();
  };

  const performApproval = async () => {
    if (!invoice) return;

    try {
      const payload: any = {};
      
      if (selectedDepartment) {
        payload.departmentId = selectedDepartment.id;
      }
      
      if (selectedProject) {
        payload.projectId = selectedProject.id;
      }
      
      if (selectedCategory) {
        payload.accountingCode = selectedCategory;
      }

      // Add justification if provided
      if (justificationText.trim()) {
        payload.justification = justificationText.trim();
      }

      const response = await fetch(`/api/invoices/${invoice.id}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (response.ok) {
        // Add to session budget tracking
        if (invoice.amount_untaxed && selectedDepartment) {
          addApprovedInvoice(
            invoice.id,
            invoice.amount_untaxed,
            selectedProject?.id,
            selectedDepartment.id
          );
        }
        
        // Redirect back to invoices list
        router.push('/invoices');
      } else {
        const error = await response.json();
        console.error("Failed to approve invoice:", error);
      }
    } catch (error) {
      console.error("Error approving invoice:", error);
    }
  };

  const CurrencySymbol = ({ currencyId }: { currencyId: string }) => {
    switch (currencyId) {
      case "EUR":
        return "€";
      case "USD":
        return "$";
      default:
        return currencyId;
    }
  };

  const getCurrentStatus = (invoice: OdooInvoice) => {
    if (invoice.x_studio_project_manager_review_status === 'pending') {
      return { variant: "destructive" as const, text: t('status.actionRequired') };
    }
    if (invoice.x_studio_project_manager_review_status === 'approved' && invoice.x_studio_is_over_budget) {
      return { variant: "secondary" as const, text: t('status.awaitingApproval') };
    }
    if (invoice.state === 'posted') {
      return { variant: "secondary" as const, text: t('status.sentForPayment') };
    }
    if (invoice.state === 'paid') {
      return { variant: "default" as const, text: t('status.paid') };
    }
    return { variant: "outline" as const, text: t('status.other') };
  };

  const isInvoiceApproved = (invoice: OdooInvoice) => {
    return invoice.x_studio_project_manager_review_status === 'approved';
  };



  if (loading) {
    return (
      <div className="container mx-auto p-4">
        <div className="flex items-center justify-center h-64">
          <div className="text-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-4"></div>
            <p className="text-muted-foreground">{t('loadingInvoice')}</p>
          </div>
        </div>
      </div>
    );
  }

  if (!invoice) {
    return (
      <div className="container mx-auto p-4">
        <div className="text-center">
          <h1 className="text-2xl font-bold mb-4">{t('invoiceNotFound')}</h1>
          <Button onClick={() => router.push('/invoices')}>
            {t('backToInvoices')}
          </Button>
        </div>
      </div>
    );
  }

  const supplier = suppliers.find(s => s.id === invoice.partner_id?.[0]);
  const firstAttachment = invoice.attachments?.[0];
  const hasAttachments = !!firstAttachment;
  const canPreviewPdf = hasAttachments && firstAttachment?.mimetype === 'application/pdf' && !!firstAttachment?.datas;
  const previewSrc = canPreviewPdf && firstAttachment?.datas
    ? `data:${firstAttachment.mimetype};base64,${firstAttachment.datas}`
    : undefined;

  return (
    <div className="container mx-auto p-4 space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Button 
          variant="ghost" 
          size="sm" 
          onClick={() => router.push('/invoices')}
          className="p-2"
        >
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div>
          <h1 className="text-2xl font-bold">{t('invoice')} #{invoice.id}</h1>
        </div>
        {(() => {
          const statusInfo = getCurrentStatus(invoice);
          return <Badge variant={statusInfo.variant} className="text-xs">{statusInfo.text}</Badge>;
        })()}
      </div>

      {/* Invoice Details */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <Building2 className="h-5 w-5" />
              {t('invoiceDetails')}
            </CardTitle>
            {/* PDF Viewer Button - only show if there are attachments */}
            {hasAttachments && (
              <Sheet open={isPdfModalOpen} onOpenChange={setIsPdfModalOpen}>
                <SheetTrigger asChild>
                  <Button 
                    variant="outline" 
                    size="sm"
                    onClick={() => setIsPdfModalOpen(true)}
                  >
                    <Eye className="h-4 w-4 mr-2" />
                    {`${t('view')} PDF`}
                  </Button>
                </SheetTrigger>
                <SheetContent className="w-full sm:max-w-2xl">
                  <SheetHeader>
                    <SheetTitle>{firstAttachment?.name || 'Attachment'}</SheetTitle>
                  </SheetHeader>
                  <div className="mt-4 h-full">
                    {canPreviewPdf && previewSrc ? (
                      <iframe
                        src={previewSrc}
                        className="w-full h-full border-0"
                        title={firstAttachment?.name}
                      />
                    ) : (
                      <div className="flex items-center justify-center h-full text-muted-foreground">
                        <p>{t('previewNotAvailable')} {firstAttachment?.mimetype}</p>
                      </div>
                    )}
                  </div>
                </SheetContent>
              </Sheet>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">{t('supplier')}</span>
              <span className="font-medium">{invoice.partner_id?.[1] || 'Unknown Supplier'}</span>
            </div>
            
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">{t('invoiceViews.approvalAlias')}</span>
              <span className="font-medium">{invoice.x_studio_project_manager_1 || 'Not Assigned'}</span>
            </div>
            
            <Separator />
            
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">{t('invoiceDate')}</span>
              <span className="font-medium">{invoice.invoice_date}</span>
            </div>
            
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">{t('dueDate')}</span>
              <span className="font-medium">{invoice.invoice_date_due}</span>
            </div>
            
            <Separator />
            
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">{t('subtotal')}</span>
              <span className="text-xl font-bold">
                <CurrencySymbol currencyId={invoice.currency_id?.[1] || 'EUR'} />
                {invoice.amount_untaxed?.toFixed(2) || '0.00'}
              </span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Department & Project Selection */}
      {hasExternalBasicPermission && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Tag className="h-5 w-5" />
              {t('assignmentDetails')}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Department Field - Always visible and mandatory */}
            <div className="space-y-2">
              <label className="text-sm font-medium">
                {t('department')} <span className="text-red-500">*</span>
              </label>
              {(() => {
                const departmentProjects = projects.filter(p => p.plan_id && (DEPARTMENT_IDENTIFIERS.includes(p.plan_id[1])));
                console.log("🎯 Rendering department select:", {
                  hasPermission: hasExternalBasicPermission,
                  totalProjects: projects.length,
                  departmentProjects: departmentProjects.length,
                  selectedDepartment: selectedDepartment?.id,
                  departmentOptions: departmentProjects.map(d => ({ id: d.id, name: d.name, plan_id: d.plan_id }))
                });
                
                return (
                  <select 
                    className="w-full p-3 border rounded-md"
                    value={selectedDepartment?.id || ''}
                    onChange={(e) => {
                      const dept = projects.find(p => p.id === parseInt(e.target.value));
                      setSelectedDepartment(dept || null);
                      // Reset project when department changes
                      setSelectedProject(null);
                    }}
                    required
                  >
                    <option value="">{t('selectDepartment')}</option>
                    {departmentProjects.map((dept) => (
                      <option key={dept.id} value={dept.id}>
                        {dept.name}
                      </option>
                    ))}
                  </select>
                );
              })()}
            </div>
            
            {/* Project Field - Only visible when "Construction" department is selected */}
            {selectedDepartment && selectedDepartment.id === CONSTRUCTION_DEPT_ID && (
              <div className="space-y-2">
                <label className="text-sm font-medium">{t('project')}</label>
                <select 
                  className="w-full p-3 border rounded-md"
                  value={selectedProject?.id || ''}
                  onChange={(e) => {
                    const project = projects.find(p => p.id === parseInt(e.target.value));
                    setSelectedProject(project || null);
                  }}
                >
                  <option value="">{t('selectProject')}</option>
                  {projects
                    .filter(p => p.plan_id && (PROJECT_IDENTIFIERS.includes(p.plan_id[1])))
                    .map((project) => (
                      <option key={project.id} value={project.id}>
                        {project.name}
                      </option>
                    ))}
                </select>
              </div>
            )}
            
            {/* Spend Category - Only visible when a project is selected */}
            {selectedProject && (
              <div className="space-y-2">
                <label className="text-sm font-medium">{t('spendCategory')}</label>
                <select 
                  className="w-full p-3 border rounded-md"
                  value={selectedCategory}
                  onChange={(e) => setSelectedCategory(e.target.value)}
                >
                  <option value="">{t('selectSpendCategory')}</option>
                  {spendCategories.map((category) => (
                    <option key={category.id} value={category.code}>
                      {category.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Budget Impact Analysis */}
      {hasExternalBasicPermission && selectedDepartment && invoice?.amount_untaxed ? (
        <BudgetImpactCard
          invoiceAmount={invoice.amount_untaxed}
          className="border-l-4 border-l-blue-500"
          invoiceType={selectedDepartment.id === CONSTRUCTION_DEPT_ID ? 'construction' : 'department'}
          // Construction-specific props
          projectId={selectedProject?.id}
          projectName={selectedProject?.name}
          spendCategoryCode={selectedCategory || undefined}
          spendCategoryName={spendCategories.find(cat => cat.code === selectedCategory)?.name}
          // Department-specific props
          departmentId={selectedDepartment.id}
          departmentName={selectedDepartment.name}
          invoiceIssueDate={invoice.invoice_date}
          onBudgetImpactChange={setBudgetImpact}
        />
      ): null}
      <div className="flex gap-3">
        <Button 
          variant="outline" 
          className="flex-1"
          onClick={() => router.push('/invoices')}
        >
          {t('backToInvoices')}
        </Button>
        <Button 
          className="flex-1"
          onClick={handleApprove}
          disabled={
            hasExternalBasicPermission && (
              !selectedDepartment || 
              userLoading || 
              (selectedDepartment.id === CONSTRUCTION_DEPT_ID && !selectedProject)
            ) ||
            isInvoiceApproved(invoice) ||
            isInvoiceApprovedInSession(parseInt(invoiceId))
          }
        >
          <Check className="h-4 w-4 mr-2" />
          {isInvoiceApproved(invoice) 
            ? t('alreadyApproved') 
            : isInvoiceApprovedInSession(parseInt(invoiceId))
              ? 'Approved in Session'
              : t('approveInvoice')
          }
        </Button>
      </div>

      {/* Budget Justification Modal */}
      {showJustificationModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-gray-800 rounded-lg p-6 max-w-2xl w-full mx-4">
            <h2 className="text-xl font-bold mb-4">{t('budgetImpact.justificationRequired')}</h2>
            <p className="text-gray-600 dark:text-gray-300 mb-4">
              {t('budgetImpact.justificationDescription')}
            </p>
            <textarea
              className="w-full p-3 border rounded-md resize-none h-32 mb-4"
              placeholder={t('budgetImpact.justificationPlaceholder')}
              value={justificationText}
              onChange={(e) => setJustificationText(e.target.value)}
            />
            <div className="flex justify-between items-center">
              <span className={`text-sm ${justificationText.length < 100 ? 'text-red-500' : 'text-green-500'}`}>
                {t('budgetImpact.justificationMinLength', { count: justificationText.length })}
              </span>
              <div className="flex gap-3">
                <Button
                  variant="outline"
                  onClick={() => {
                    setShowJustificationModal(false);
                    setJustificationText('');
                  }}
                >
                  {t('cancel')}
                </Button>
                <Button
                  onClick={() => {
                    setShowJustificationModal(false);
                    performApproval();
                  }}
                  disabled={justificationText.length < 100}
                >
                  {t('budgetImpact.approveWithJustification')}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
