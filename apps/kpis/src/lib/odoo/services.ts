import { odooApi } from "./api";
import { ODOO_MAIN_COMPANY_ID } from "../constants/odoo";
import { createClient } from '@supabase/supabase-js';
import { isZeroValueInvoice } from "../utils/invoiceUtils";
import { ocrNotificationService } from "../services/ocrNotificationService";
import { OdooSupplier, OdooProject, OdooSpendCategory, OdooAttachment, OdooInvoice, OdooInvoiceAttachment, OdooInvoiceLineItem, OdooBudget, OdooBudgetLineItem, BudgetImpact } from '@isleno/types/odoo';

const INVOICE_MODEL = 'account.move';
const SUPPLIER_MODEL = 'res.partner';
const ATTACHMENT_MODEL = 'ir.attachment';
const PROJECT_MODEL = 'account.analytic.account';
const ACCOUNT_MODEL = 'account.account';
const LINE_ITEM_MODEL = 'account.move.line';
const BUDGET_MODEL = 'account.report.budget';
const BUDGET_LINE_MODEL = 'account.report.budget.item';

export async function getInvoice(invoiceId: number): Promise<OdooInvoice | null> {
    const domain = [
        ["id", "=", invoiceId],
        ["move_type", "=", "in_invoice"],
        ["state", "!=", "cancel"]
    ];

    const fields = [
        "id",
        "partner_id",
        "invoice_date",
        "invoice_date_due",
        "amount_untaxed",
        "currency_id",
        "x_studio_project_manager_review_status",
        "x_studio_project_manager_1",
        "state",
        "name",
        "message_main_attachment_id",
        "invoice_line_ids"
    ];

    const invoices = await odooApi.searchRead(INVOICE_MODEL, domain, { fields });

    if (invoices.length === 0) {
        return null;
    }

    const invoice = invoices[0];

    // Fetch line items with analytic_distribution to get assigned department/project
    if (invoice.invoice_line_ids && invoice.invoice_line_ids.length > 0) {
        const lineItemFields = ["id", "account_id", "analytic_distribution", "price_subtotal", "name"];
        const lineItems = await odooApi.searchRead(LINE_ITEM_MODEL, [
            ["id", "in", invoice.invoice_line_ids],
            ["display_type", "=", false] // Exclude section/note lines
        ], { fields: lineItemFields });
        invoice.line_items = lineItems;
    }

    // Fetch attachments for this invoice
    const attachmentDomain = [
        ["res_model", "=", INVOICE_MODEL],
        ["res_id", "=", invoice.id],
    ];
    const attachmentFields = ["id", "name", "mimetype", "datas"];
    const attachments = await odooApi.searchRead(ATTACHMENT_MODEL, attachmentDomain, { fields: attachmentFields });
    invoice.attachments = attachments;

    // Auto-fix: Check if invoice needs OCR processing
    const hasZeroValue = !invoice.amount_untaxed || invoice.amount_untaxed === 0;
    const hasAttachments = attachments.length > 0;
    
    if (hasZeroValue && hasAttachments) {
        console.log(`Invoice ${invoiceId} has zero value with attachments - checking for auto-fix...`);
        
        // Check if message_main_attachment_id is set
        const hasMainAttachmentId = invoice.message_main_attachment_id && 
                                    (Array.isArray(invoice.message_main_attachment_id) ? 
                                     invoice.message_main_attachment_id[0] : 
                                     invoice.message_main_attachment_id);

        try {
            let attachmentId = hasMainAttachmentId;
            
            // If attachment not linked, link it first
            if (!hasMainAttachmentId) {
                console.log(`Linking attachment to invoice ${invoiceId}...`);
                attachmentId = attachments[0].id;
                await odooApi.write(INVOICE_MODEL, [invoiceId], {
                    message_main_attachment_id: attachmentId
                });
            }

            // CRITICAL: Reset Extract error state (this is what the "Retry" button does!)
            await resetExtractErrorState(invoiceId);

            // Trigger OCR processing
            console.log(`Triggering OCR for invoice ${invoiceId}...`);
            try {
                const ocrResult = await odooApi.executeKw(
                    'account.move',
                    'action_reload_ai_data',
                    [[invoiceId]]
                );
                console.log(`OCR triggered successfully for invoice ${invoiceId}, result:`, ocrResult);
            } catch (ocrError: any) {
                console.error(`OCR trigger failed for invoice ${invoiceId}:`, ocrError.message);
                // Error will be handled by outer catch to allow invoice viewing even on failure
            }
            
            console.log(`Auto-fix completed for invoice ${invoiceId} - extract state reset and OCR triggered`);
        } catch (error) {
            console.error(`Auto-fix failed for invoice ${invoiceId}:`, error);
            // Don't throw - return invoice as-is so user can still view it
        }
    }

    return invoice;
}

export async function getPendingInvoices(invoiceApprovalAlias?: string): Promise<OdooInvoice[]> {
    
    const domain = [
        ["move_type", "=", "in_invoice"],
        ["x_studio_project_manager_review_status", "=", "pending"],
        ["state", "!=", "cancel"]
    ];

    // Add user-specific filtering if invoice_approval_alias is provided
    if (invoiceApprovalAlias) {
        domain.push(["x_studio_project_manager_1", "=", invoiceApprovalAlias.toLowerCase()]);
    }

    const fields = [
        "id",
        "partner_id",
        "invoice_date",
        "invoice_date_due",
        "amount_untaxed", 
        "currency_id",
        "x_studio_project_manager_1", // Include the project manager field for verification
        "invoice_line_ids" // Include line items for project assignment
    ];

    const invoices = await odooApi.searchRead(INVOICE_MODEL, domain, { fields });

    // Fetch attachments for each invoice
    for (const invoice of invoices) {
        const attachmentDomain = [
            ["res_model", "=", INVOICE_MODEL],
            ["res_id", "=", invoice.id],
        ];
        const attachmentFields = ["id", "name", "mimetype", "datas"];
        const attachments = await odooApi.searchRead(ATTACHMENT_MODEL, attachmentDomain, { fields: attachmentFields });
        invoice.attachments = attachments;
    }

    return invoices;
}

export async function getInvoiceCount(invoiceApprovalAlias?: string): Promise<number> {
    const domain = [
        ["move_type", "=", "in_invoice"],
        ["state", "!=", "cancel"]
    ];

    // Add user-specific filtering if invoice_approval_alias is provided
    if (invoiceApprovalAlias) {
        domain.push(["x_studio_project_manager_1", "=", invoiceApprovalAlias.toLowerCase()]);
    }

    const result = await odooApi.executeKw(INVOICE_MODEL, 'search_count', [domain]);
    return result;
}

export async function getAllInvoices(
    invoiceApprovalAlias?: string,
    skipOcrRefresh: boolean = false,
    limit?: number,
    offset?: number,
    includeAttachmentData: boolean = false
): Promise<{
  invoices: OdooInvoice[];
  ocrRefreshPerformed: boolean;
  zeroValueInvoicesRefreshed: number;
  zeroValueInvoiceIds: number[];
}> {
    
    const domain = [
        ["move_type", "=", "in_invoice"],
        ["state", "!=", "cancel"]
    ];

    // Add user-specific filtering if invoice_approval_alias is provided
    if (invoiceApprovalAlias) {
        domain.push(["x_studio_project_manager_1", "=", invoiceApprovalAlias.toLowerCase()]);
    }

    const fields = [
        "id",
        "partner_id",
        "invoice_date",
        "invoice_date_due",
        "amount_untaxed", 
        "currency_id",
        "x_studio_project_manager_review_status",
        "x_studio_project_manager_1",
        "state",
        "name",
        "x_studio_is_over_budget",
        "x_studio_amount_over_budget",
        "x_studio_cfo_sign_off",
        "x_studio_ceo_sign_off"
    ];

    // Add pagination parameters
    const searchOptions: any = { fields };
    if (limit !== undefined) {
        searchOptions.limit = limit;
    }
    if (offset !== undefined) {
        searchOptions.offset = offset;
    }

    const invoices = await odooApi.searchRead(INVOICE_MODEL, domain, searchOptions);

    if (invoices.length > 0) {
        const invoiceIds = invoices.map(invoice => invoice.id);
        const attachmentDomain = [
            ["res_model", "=", INVOICE_MODEL],
            ["res_id", "in", invoiceIds],
        ];
        const attachmentFields = includeAttachmentData
            ? ["id", "name", "mimetype", "datas", "res_id"]
            : ["id", "name", "mimetype", "res_id"];
        const attachmentSearchOptions: any = {
            fields: attachmentFields,
            limit: 0
        };
        const allAttachments = await odooApi.searchRead(ATTACHMENT_MODEL, attachmentDomain, attachmentSearchOptions) as OdooAttachment[];
        const attachmentsByInvoice = new Map<number, OdooInvoiceAttachment[]>();

        for (const attachment of allAttachments) {
            if (!attachment.res_id) {
                continue;
            }

            const current = attachmentsByInvoice.get(attachment.res_id) ?? [];
            current.push({
                id: attachment.id,
                name: attachment.name,
                mimetype: attachment.mimetype,
                datas: includeAttachmentData ? attachment.datas : undefined
            });
            attachmentsByInvoice.set(attachment.res_id, current);
        }

        for (const invoice of invoices) {
            invoice.attachments = attachmentsByInvoice.get(invoice.id) ?? [];
        }
    }

    // Identify zero-value invoices
    const zeroValueInvoices = invoices.filter(isZeroValueInvoice);

    // If OCR refresh is enabled and there are zero-value invoices, start background refresh
    if (!skipOcrRefresh && zeroValueInvoices.length > 0) {
        // Filter to only include invoices that actually have attachments
        // This prevents repeated API calls for invoices that legitimately have no attachments
        const invoicesWithAttachments = zeroValueInvoices.filter(inv => 
            inv.attachments && inv.attachments.length > 0
        );
        
        if (invoicesWithAttachments.length > 0) {
            const invoiceIds = invoicesWithAttachments.map(inv => inv.id);
            
            console.log(`Found ${zeroValueInvoices.length} zero-value invoices, ${invoicesWithAttachments.length} have attachments to process`);
            
            // Notify that OCR refresh is starting
            ocrNotificationService.startRefresh(invoiceIds);
            
            // Start background OCR refresh without blocking the response
            refreshOcrDataForInvoices(invoiceIds)
                .then(result => {
                    ocrNotificationService.completeRefresh(result);
                })
                .catch(error => {
                    console.error('Background OCR refresh failed:', error);
                    ocrNotificationService.failRefresh(error instanceof Error ? error.message : 'Unknown error');
                });
        } else {
            console.log(`Found ${zeroValueInvoices.length} zero-value invoices, but none have attachments to process`);
        }
    }

    // Determine which invoices were actually processed for OCR
    const processedForOcr = !skipOcrRefresh && zeroValueInvoices.length > 0
        ? zeroValueInvoices.filter(inv => inv.attachments && inv.attachments.length > 0)
        : [];

    return {
        invoices,
        ocrRefreshPerformed: !skipOcrRefresh && processedForOcr.length > 0,
        zeroValueInvoicesRefreshed: processedForOcr.length,
        zeroValueInvoiceIds: processedForOcr.map(inv => inv.id)
    };
}

/**
 * Reset the extract error state for an invoice
 * This is what the "Retry" button does to clear previous OCR errors
 */
async function resetExtractErrorState(invoiceId: number): Promise<void> {
    console.log(`Resetting extract error state for invoice ${invoiceId}...`);
    await odooApi.write(INVOICE_MODEL, [invoiceId], {
        extract_state: 'no_extract_requested',
        extract_status: false,
        extract_error_message: false
    });
    console.log(`Extract error state cleared for invoice ${invoiceId}`);
}

/**
 * Ensure invoice has proper attachment linkage for OCR processing
 * This fixes the "document not found" issue by linking attachments and regenerating access tokens
 */
async function ensureInvoiceAttachmentLinkage(invoiceId: number): Promise<boolean> {
    try {
        // Fetch the invoice to check message_main_attachment_id
        const invoiceData = await odooApi.searchRead(INVOICE_MODEL, [
            ["id", "=", invoiceId]
        ], {
            fields: ["id", "message_main_attachment_id"]
        });

        if (!invoiceData || invoiceData.length === 0) {
            console.error(`Invoice ${invoiceId} not found`);
            return false;
        }

        const invoice = invoiceData[0];
        let attachmentId = invoice.message_main_attachment_id && 
                          (Array.isArray(invoice.message_main_attachment_id) ? 
                           invoice.message_main_attachment_id[0] : 
                           invoice.message_main_attachment_id);

        // If message_main_attachment_id is not set, link an attachment
        if (!attachmentId) {
            // Check if there are any attachments for this invoice
            const attachments = await odooApi.searchRead(ATTACHMENT_MODEL, [
                ["res_model", "=", INVOICE_MODEL],
                ["res_id", "=", invoiceId]
            ], {
                fields: ["id", "name", "mimetype"],
                limit: 1
            });

            if (attachments.length === 0) {
                console.log(`Invoice ${invoiceId} has no attachments to link`);
                return false;
            }

            // Link the first attachment as the main attachment
            attachmentId = attachments[0].id;
            console.log(`Linking attachment ${attachmentId} to invoice ${invoiceId} as message_main_attachment_id`);
            
            await odooApi.write(INVOICE_MODEL, [invoiceId], {
                message_main_attachment_id: attachmentId
            });

            console.log(`Successfully linked attachment ${attachmentId} to invoice ${invoiceId}`);
        }

        // CRITICAL: Reset Extract error state (this is what the "Retry" button does!)
        await resetExtractErrorState(invoiceId);

        return true;
    } catch (error) {
        console.error(`Failed to ensure attachment linkage for invoice ${invoiceId}:`, error);
        return false;
    }
}

/**
 * Background function to refresh OCR data for zero-value invoices
 * This runs asynchronously and doesn't block the main response
 */
async function refreshOcrDataForInvoices(invoiceIds: number[]) {
    console.log(`Starting background OCR refresh for ${invoiceIds.length} invoices...`);
    
    const startTime = Date.now();
    const results = [];
    
    for (let i = 0; i < invoiceIds.length; i++) {
        const invoiceId = invoiceIds[i];
        try {
            // Step 1: Ensure attachment is properly linked (fixes "document not found" issue)
            const attachmentLinked = await ensureInvoiceAttachmentLinkage(invoiceId);
            
            if (!attachmentLinked) {
                console.warn(`Invoice ${invoiceId} has no attachment to link, skipping OCR refresh`);
                results.push({ 
                    invoiceId, 
                    success: false, 
                    error: 'No attachment found to process',
                    attachmentLinkage: 'no_attachment'
                });
                ocrNotificationService.updateProgress(i + 1, invoiceIds.length);
                continue;
            }

            // Step 2: Trigger OCR processing
            await odooApi.executeKw(
                'account.move',
                'action_reload_ai_data',
                [[invoiceId]]
            );
            
            console.log(`Successfully refreshed OCR data for invoice ${invoiceId}`);
            results.push({ 
                invoiceId, 
                success: true, 
                error: null,
                attachmentLinkage: 'linked'
            });
        } catch (error) {
            console.error(`Failed to refresh OCR data for invoice ${invoiceId}:`, error);
            results.push({ 
                invoiceId, 
                success: false, 
                error: error instanceof Error ? error.message : 'Unknown error',
                attachmentLinkage: 'unknown'
            });
        }
        
        // Update progress after each invoice
        ocrNotificationService.updateProgress(i + 1, invoiceIds.length);
    }
    
    const endTime = Date.now();
    const duration = endTime - startTime;
    
    const successful = results.filter(r => r.success).length;
    const failed = results.filter(r => !r.success).length;
    const noAttachment = results.filter(r => r.attachmentLinkage === 'no_attachment').length;
    
    console.log(`Background OCR refresh completed in ${duration}ms: ${successful}/${invoiceIds.length} successful, ${failed} failed, ${noAttachment} without attachments`);
    
    // Log detailed results for debugging
    if (failed > 0) {
        const failedInvoices = results.filter(r => !r.success);
        console.log('Failed invoices:', failedInvoices.map(r => ({ 
            id: r.invoiceId, 
            error: r.error,
            attachmentStatus: r.attachmentLinkage 
        })));
    }
    
    return {
        totalInvoices: invoiceIds.length,
        successful,
        failed,
        duration,
        results,
        completedAt: new Date().toISOString()
    };
}

export async function getAwaitingApprovalInvoices(invoiceApprovalAlias?: string): Promise<OdooInvoice[]> {
    const domain = [
        ["move_type", "=", "in_invoice"],
        ["x_studio_project_manager_review_status", "=", "approved"],
        ["x_studio_is_over_budget", "=", true],
        ["state", "!=", "cancel"], // Exclude cancelled invoices
        "|",
        ["x_studio_cfo_sign_off", "=", false],
        "&",
        ["x_studio_amount_over_budget", ">=", 3000],
        ["x_studio_ceo_sign_off", "=", false]
    ];

    // Add user-specific filtering if invoice_approval_alias is provided
    if (invoiceApprovalAlias) {
        domain.push(["x_studio_project_manager_1", "=", invoiceApprovalAlias.toLowerCase()]);
    }

    const fields = [
        "id",
        "partner_id",
        "invoice_date",
        "invoice_date_due",
        "amount_untaxed", 
        "currency_id",
        "x_studio_project_manager_review_status",
        "x_studio_is_over_budget",
        "x_studio_amount_over_budget",
        "x_studio_cfo_sign_off",
        "x_studio_ceo_sign_off",
        "state",
        "name"
    ];

    const invoices = await odooApi.searchRead(INVOICE_MODEL, domain, { fields });

    // Fetch attachments for each invoice
    for (const invoice of invoices) {
        const attachmentDomain = [
            ["res_model", "=", INVOICE_MODEL],
            ["res_id", "=", invoice.id],
        ];
        const attachmentFields = ["id", "name", "mimetype", "datas"];
        const attachments = await odooApi.searchRead(ATTACHMENT_MODEL, attachmentDomain, { fields: attachmentFields });
        invoice.attachments = attachments;
    }

    return invoices;
}

export async function getSentForPaymentInvoices(invoiceApprovalAlias?: string): Promise<OdooInvoice[]> {
    const domain = [
        ["move_type", "=", "in_invoice"],
        ["state", "=", "posted"]
        // Note: "posted" state already excludes cancelled invoices by definition
    ];

    // Add user-specific filtering if invoice_approval_alias is provided
    if (invoiceApprovalAlias) {
        domain.push(["x_studio_project_manager_1", "=", invoiceApprovalAlias.toLowerCase()]);
    }

    const fields = [
        "id",
        "partner_id",
        "invoice_date",
        "invoice_date_due",
        "amount_untaxed", 
        "currency_id",
        "x_studio_project_manager_review_status",
        "state",
        "name"
    ];

    const invoices = await odooApi.searchRead(INVOICE_MODEL, domain, { fields });

    // Fetch attachments for each invoice
    for (const invoice of invoices) {
        const attachmentDomain = [
            ["res_model", "=", INVOICE_MODEL],
            ["res_id", "=", invoice.id],
        ];
        const attachmentFields = ["id", "name", "mimetype", "datas"];
        const attachments = await odooApi.searchRead(ATTACHMENT_MODEL, attachmentDomain, { fields: attachmentFields });
        invoice.attachments = attachments;
    }

    return invoices;
}

export async function getPaidInvoices(invoiceApprovalAlias?: string): Promise<OdooInvoice[]> {
    const domain = [
        ["move_type", "=", "in_invoice"],
        ["state", "=", "paid"]
        // Note: "paid" state already excludes cancelled invoices by definition
    ];

    // Add user-specific filtering if invoice_approval_alias is provided
    if (invoiceApprovalAlias) {
        domain.push(["x_studio_project_manager_1", "=", invoiceApprovalAlias.toLowerCase()]);
    }

    const fields = [
        "id",
        "partner_id",
        "invoice_date",
        "invoice_date_due",
        "amount_untaxed", 
        "currency_id",
        "x_studio_project_manager_review_status",
        "state",
        "name"
    ];

    const invoices = await odooApi.searchRead(INVOICE_MODEL, domain, { fields });

    // Fetch attachments for each invoice
    for (const invoice of invoices) {
        const attachmentDomain = [
            ["res_model", "=", INVOICE_MODEL],
            ["res_id", "=", invoice.id],
        ];
        const attachmentFields = ["id", "name", "mimetype", "datas"];
        const attachments = await odooApi.searchRead(ATTACHMENT_MODEL, attachmentDomain, { fields: attachmentFields });
        invoice.attachments = attachments;
    }

    return invoices;
}

export async function getOtherInvoices(invoiceApprovalAlias?: string): Promise<OdooInvoice[]> {
    const domain = [
        ["move_type", "=", "in_invoice"],
        ["state", "!=", "cancel"],
        "!",
        ["x_studio_project_manager_review_status", "=", "pending"],
        "!",
        ["x_studio_project_manager_review_status", "=", "approved"],
        "!",
        ["state", "=", "posted"],
        "!",
        ["state", "=", "paid"]
    ];

    // Add user-specific filtering if invoice_approval_alias is provided
    if (invoiceApprovalAlias) {
        domain.push(["x_studio_project_manager_1", "=", invoiceApprovalAlias.toLowerCase()]);
    }

    const fields = [
        "id",
        "partner_id",
        "invoice_date",
        "invoice_date_due",
        "amount_untaxed", 
        "currency_id",
        "x_studio_project_manager_review_status",
        "state",
        "name"
    ];

    const invoices = await odooApi.searchRead(INVOICE_MODEL, domain, { fields });

    // Fetch attachments for each invoice
    for (const invoice of invoices) {
        const attachmentDomain = [
            ["res_model", "=", INVOICE_MODEL],
            ["res_id", "=", invoice.id],
        ];
        const attachmentFields = ["id", "name", "mimetype", "datas"];
        const attachments = await odooApi.searchRead(ATTACHMENT_MODEL, attachmentDomain, { fields: attachmentFields });
        invoice.attachments = attachments;
    }

    return invoices;
}

export async function getSuppliers(): Promise<OdooSupplier[]> {
    const domain = [
        ["company_id", "=", ODOO_MAIN_COMPANY_ID], // Filter by main company
    ];
    const fields = ["id", "name", "x_studio_accounting_code"];
    return odooApi.searchRead(SUPPLIER_MODEL, domain, { fields });
}

export async function getProjects(): Promise<OdooProject[]> {
    try {

        const domain = [
            ["active", "=", true],
            ["name", "!=", false], // Ensure name is not false/null
            ["name", "!=", ""],     // Ensure name is not empty string
            // Removed company_id filter to fetch ALL projects across companies
        ];
        const fields = ["id", "name", "code", "plan_id"];
        const kwargs = {
            order: "name asc", // Order by name to ensure consistent results
            limit: 1000        // Add reasonable limit to prevent excessive data
        };

        const projects = await odooApi.searchRead(PROJECT_MODEL, domain, { fields, ...kwargs });

        return projects;
    } catch (error) {
        console.error("❌ Odoo getProjects error:", error);
        throw error;
    }
}

export async function getSpendCategories(): Promise<OdooSpendCategory[]> {
        
    // Filter for expense accounts that are marked as visible to project managers
    // Note: account.account model may not have 'active' field, so we'll filter by code instead
    const domain = [
        ["x_studio_show_to_pm_mostrar_a_pm", "=", true],  // Only show categories marked for PM visibility
    ];
    
    const fields = ["id", "name", "code"];
    const kwargs = {
        order: "name asc",
        limit: 1000
    };
    
    const categories = await odooApi.searchRead(ACCOUNT_MODEL, domain, { fields, ...kwargs });
    
    return categories;
}

export async function getCurrentUserProfile(userId: string) {
    try {
        const supabase = createClient(
            process.env.NEXT_PUBLIC_SUPABASE_URL!,
            process.env.SUPABASE_SERVICE_ROLE_KEY!
        );

        // Get user profile with department information
        const { data: profile, error } = await supabase
            .from('profiles')
            .select(`
                *,
                departments!inner(
                    department_id,
                    department_name,
                    odoo_group_id
                )
            `)
            .eq('id', userId)
            .single();

        if (error) {
            console.error('Error fetching user profile:', error);
            return { profile: null, department: null, error: error.message };
        }

        return { 
            profile, 
            department: profile?.departments || null,
            error: null 
        };
    } catch (error) {
        console.error('Error in getCurrentUserProfile:', error);
        return { profile: null, department: null, error: 'Failed to fetch user profile' };
    }
}

export async function updateInvoice(invoiceId: number, data: any) {
    return odooApi.write(INVOICE_MODEL, [invoiceId], data);
}

/**
 * Get department name by department ID
 * @param departmentId - The department ID
 * @returns Department name or null if not found
 */
async function getDepartmentName(departmentId: number): Promise<string | null> {
    try {
        const { supabaseServer } = await import('@/lib/supabaseServer');
        const supabase = await supabaseServer();
        
        const { data: department } = await supabase
            .from('departments')
            .select('department_name')
            .eq('department_id', departmentId.toString())
            .single();
            
        return department?.department_name || null;
    } catch (error) {
        console.error('Error getting department name:', error);
        return null;
    }
}

export async function approveInvoice(invoiceId: number, departmentId?: number, projectId?: number, accountingCode?: string, justification?: string, invoiceApprovalAlias?: string) {
    const data: any = {
        "x_studio_project_manager_review_status": "approved"
    };

    // Get invoice details for budget calculations
    try {
        const invoiceDetails = await odooApi.searchRead(INVOICE_MODEL, [
            ["id", "=", invoiceId]
        ], {
            fields: ["id", "amount_untaxed", "invoice_date"]
        });

        if (invoiceDetails && invoiceDetails.length > 0) {
            const invoice = invoiceDetails[0];
            const subtotal = invoice.amount_untaxed || 0;
            const invoiceDate = invoice.invoice_date;

            // Calculate €3000 threshold fields
            if (subtotal > 3000) {
                data.x_studio_is_over_budget = true;
                data.x_studio_amount_over_budget = subtotal - 3000;
            } else {
                data.x_studio_is_over_budget = false;
                data.x_studio_amount_over_budget = 0;
            }

            // Calculate department/project budget fields
            try {
                let budgetImpact = null;
                
                if (projectId && accountingCode) {
                    // Construction invoice - use project and spend category
                    budgetImpact = await calculateConstructionBudgetImpact(projectId, accountingCode, subtotal);
                } else if (departmentId && invoiceDate) {
                    // Department invoice - use department and invoice date
                    const departmentName = await getDepartmentName(departmentId);
                    if (departmentName) {
                        budgetImpact = await calculateDepartmentBudgetImpact(departmentId, departmentName, subtotal, invoiceDate);
                    }
                }

                if (budgetImpact && budgetImpact.willBeOverBudget) {
                    data.x_studio_is_over_project_dept_budget = true;
                    data.x_studio_amount_over_project_dept_budget = Math.abs(budgetImpact.projectedRemaining);
                } else {
                    data.x_studio_is_over_project_dept_budget = false;
                    data.x_studio_amount_over_project_dept_budget = 0;
                }
            } catch (budgetError) {
                console.error('Error calculating budget impact:', budgetError);
                // Set default values if budget calculation fails
                data.x_studio_is_over_project_dept_budget = false;
                data.x_studio_amount_over_project_dept_budget = 0;
            }
        }
    } catch (error) {
        console.error('Error getting invoice details for budget calculation:', error);
        // Set default values if we can't get invoice details
        data.x_studio_is_over_budget = false;
        data.x_studio_amount_over_budget = 0;
        data.x_studio_is_over_project_dept_budget = false;
        data.x_studio_amount_over_project_dept_budget = 0;
    }

    // Add justification as a message to the invoice if provided
    if (justification && invoiceApprovalAlias) {
        try {
            const messageContent = `Justification from PM/HOD:\n\n${justification}\n\nSubmitted by ${invoiceApprovalAlias}`;
            
            // Use message_post method on the invoice record instead of creating mail.message directly
            const messageResult = await odooApi.executeKw(INVOICE_MODEL, 'message_post', [invoiceId], {
                message_type: 'comment',
                subtype_id: 1,
                body: messageContent
            });
            
            console.log('Successfully added justification message to invoice:', messageResult);
        } catch (error) {
            console.error('Error adding justification message to invoice:', error);
            // Re-throw the error so it can be handled by the calling function
            throw new Error(`Failed to add justification message: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    // Get non-tax line items for this invoice
    try {
        // First, let's test what fields are available and see the accounting codes
        const lineItems = await odooApi.searchRead(LINE_ITEM_MODEL, [
            ["move_id", "=", invoiceId], 
            ["tax_line_id", "=", false]  // Filter out tax lines
        ], {
            fields: ['id', 'account_id', 'account_code', 'name', 'debit', 'credit']
        });

        if (lineItems.length > 0) {
            // Filter for lines where accounting code starts with "6" (expense accounts)
            const expenseLines = lineItems.filter((line: any) => {
                // Try different possible field names for accounting code
                const accountCode = line.account_code || line.account_id?.[2] || line.account_id?.[1];
                
                if (accountCode && typeof accountCode === 'string' && accountCode.startsWith('6')) {
                    return true;
                }
                return false;
            });

            if (expenseLines.length > 0) {
                const lineIds = expenseLines.map((line: any) => line.id);
                
                // Prepare update data for line items
                const updateData: Record<string, any> = {};
                
                if (accountingCode && accountingCode.trim() !== '') {
                    // The accountingCode parameter is the account_code string (e.g., '62700022')
                    // We need to find the actual account_id that corresponds to this account_code
                    // Let's fetch the account record by code to get its ID
                    try {
                        const accountRecord = await odooApi.searchRead(ACCOUNT_MODEL, [
                            ["code", "=", accountingCode]
                        ], {
                            fields: ["id"]
                        });
                        
                        if (accountRecord && accountRecord.length > 0) {
                            // Update both account_id and account_code
                            updateData['account_id'] = accountRecord[0].id;
                            updateData['account_code'] = accountingCode;
                        } else {
                            console.warn(`No account found with code: ${accountingCode}`);
                            // Still update account_code even if we can't find the account_id
                            updateData['account_code'] = accountingCode;
                        }
                    } catch (error) {
                        console.error('Failed to fetch account by code:', error);
                        // Fallback: just update account_code
                        updateData['account_code'] = accountingCode;
                    }
                }
                
                // Handle project allocation based on department selection
                if (departmentId) {
                    if (projectId) {
                        // If both department and project are selected, allocate 100% to the project
                        updateData['analytic_distribution'] = {
                            [projectId.toString()]: 100.0
                        };
                    } else {
                        // If only department is selected, allocate 100% to the department
                        updateData['analytic_distribution'] = {
                            [departmentId.toString()]: 100.0
                        };
                    }
                }

                // Update line items in a single write call if there's data to update
                if (Object.keys(updateData).length > 0) {
                    try {
                        await odooApi.write(LINE_ITEM_MODEL, lineIds, updateData);
                    } catch (error) {
                        console.error('Failed to update expense line items:', error);
                    }
                }
            }
        }
    } catch (error) {
        console.error('Failed to get or update line items:', error);
        // Continue with approval even if line item updates fail
    }

    return odooApi.write(INVOICE_MODEL, [invoiceId], data);
}

/**
 * Get budget data for a specific project (construction invoices)
 * @param projectId - The project ID (analytic account ID)
 * @returns Budget data from Odoo or null if not found
 */
export async function getBudgetForProject(projectId: number): Promise<OdooBudget | null> {
    try {
        // First, get the project name to search for budget by name
        const projectDomain = [
            ["id", "=", projectId]
        ];
        const projectFields = ["id", "name"];
        const projects = await odooApi.searchRead(PROJECT_MODEL, projectDomain, { fields: projectFields });
        
        if (projects.length === 0) {
            console.warn(`Project ${projectId} not found`);
            return null;
        }
        
        const projectName = projects[0].name;
        
        // Search for budget by project name (similar to department approach)
        const domain = [
            ["company_id", "=", ODOO_MAIN_COMPANY_ID],
            ["name", "ilike", projectName]
        ];

        const fields = [
            "id",
            "name",
            "display_name",
            "company_id",
            "item_ids",
            "sequence",
            "create_date",
            "create_uid",
            "write_date",
            "write_uid"
        ];

        const budgets = await odooApi.searchRead(BUDGET_MODEL, domain, { 
            fields,
            order: "create_date desc" // Get most recent budget first
        });
        
        if (budgets.length > 0) {
            return budgets[0];
        }
        
        console.warn(`No budget found for project ${projectName} (ID: ${projectId})`);
        return null;
    } catch (error) {
        console.error('Error fetching budget for project:', projectId, error);
        return null;
    }
}

/**
 * Get budget data for a specific department (non-construction invoices)
 * @param departmentName - The department name
 * @returns Budget data from Odoo or null if not found
 */
export async function getBudgetForDepartment(departmentName: string): Promise<OdooBudget | null> {
    try {
        const domain = [
            ["company_id", "=", ODOO_MAIN_COMPANY_ID],
            ["name", "ilike", `Department ${departmentName}`]
        ];

        const fields = [
            "id",
            "name",
            "display_name",
            "company_id",
            "item_ids",
            "sequence",
            "create_date",
            "create_uid",
            "write_date",
            "write_uid"
        ];

        const budgets = await odooApi.searchRead(BUDGET_MODEL, domain, { fields });
        
        if (budgets.length > 0) {
            return budgets[0];
        }
        
        return null;
    } catch (error) {
        console.error('Error fetching budget for department:', departmentName, error);
        return null;
    }
}

/**
 * Get budget line item for a specific spend category
 * @param budgetId - The budget ID
 * @param spendCategoryId - The spend category ID
 * @returns Budget line item data or null if not found
 */
export async function getBudgetLineItem(budgetId: number, spendCategoryCode: string): Promise<OdooBudgetLineItem | null> {
    try {
        
        // First, convert account code to account ID
        const accountRecord = await odooApi.searchRead(ACCOUNT_MODEL, [
            ["code", "=", spendCategoryCode]
        ], {
            fields: ["id"]
        });
        
        if (!accountRecord || accountRecord.length === 0) {
            console.warn(`No account found with code: ${spendCategoryCode}`);
            return null;
        }
        
        const accountId = accountRecord[0].id;
        
        // Now search for the budget line item using the account ID
        const domain = [
            ["budget_id", "=", budgetId],
            ["account_id", "=", accountId]
        ];

        const fields = [
            "id",
            "budget_id",
            "account_id",
            "amount",
            "date",
            "display_name",
            "create_uid",
            "create_date",
            "write_uid",
            "write_date"
        ];

        const lineItems = await odooApi.searchRead(BUDGET_LINE_MODEL, domain, { fields });
        
        if (lineItems.length > 0) {
            return lineItems[0] as OdooBudgetLineItem;
        }
        
        return null;
    } catch (error) {
        console.error('Error fetching budget line item:', budgetId, spendCategoryCode, error);
        return null;
    }
}

/**
 * Get all budget line items for a budget
 * @param budgetId - The budget ID
 * @returns Array of budget line items
 */
export async function getAllBudgetLineItems(budgetId: number): Promise<OdooBudgetLineItem[]> {
    try {
        const domain = [
            ["budget_id", "=", budgetId]
        ];

        // Fetch all budget line item fields
        const fields = [
            "id",
            "budget_id",
            "account_id",
            "amount",
            "date",
            "display_name",
            "create_uid",
            "create_date",
            "write_uid",
            "write_date"
        ];

        const lineItems = await odooApi.searchRead(BUDGET_LINE_MODEL, domain, { fields });
        
        return lineItems as OdooBudgetLineItem[];
    } catch (error) {
        console.error('Error fetching budget line items:', budgetId, error);
        return [];
    }
}

/**
 * Get approved invoices for construction project and spend category
 * @param projectId - The project ID
 * @param spendCategoryId - The spend category ID
 * @returns Array of approved invoices
 */
export async function getApprovedInvoicesForProjectAndCategory(projectId: number, spendCategoryCode: string): Promise<{invoice: OdooInvoice, amount: number}[]> {
    try {
        
        // First, get the account ID for the spend category code
        const accountRecord = await odooApi.searchRead(ACCOUNT_MODEL, [
            ["code", "=", spendCategoryCode]
        ], {
            fields: ["id"]
        });
        
        if (!accountRecord || accountRecord.length === 0) {
            console.warn(`No account found with code: ${spendCategoryCode}`);
            return [];
        }
        
        const accountId = accountRecord[0].id;
        
        // Get approved invoices
        const domain = [
            ["move_type", "=", "in_invoice"],
            ["x_studio_project_manager_review_status", "=", "approved"],
            ["state", "!=", "cancel"]
        ];

        const fields = [
            "id",
            "amount_untaxed",
            "invoice_date_due",
            "line_ids"
        ];

        const invoices = await odooApi.searchRead(INVOICE_MODEL, domain, { fields });
        
        const result: {invoice: OdooInvoice, amount: number}[] = [];
        
        // For each invoice, check its line items
        for (const invoice of invoices) {
            if (!invoice.line_ids || invoice.line_ids.length === 0) {
                continue;
            }
            
            // Get line items for this invoice
            const lineItems = await odooApi.searchRead(LINE_ITEM_MODEL, [
                ["id", "in", invoice.line_ids]
            ], {
                fields: ["id", "move_id", "account_id", "analytic_distribution", "price_subtotal"]
            });
            
            // Filter line items that match our project and account
            const matchingLines = lineItems.filter((line: OdooInvoiceLineItem) => {
                // Check if account matches
                const lineAccountId = Array.isArray(line.account_id) ? line.account_id[0] : line.account_id;
                if (lineAccountId !== accountId) {
                    return false;
                }
                
                // Check if analytic distribution includes our project
                if (!line.analytic_distribution) {
                    return false;
                }
                
                return Object.keys(line.analytic_distribution).includes(projectId.toString());
            });
            
            if (matchingLines.length > 0) {
                // Calculate total amount for matching lines
                const totalAmount = matchingLines.reduce((sum, line) => sum + (line.price_subtotal || 0), 0);
                result.push({
                    invoice: invoice as OdooInvoice,
                    amount: totalAmount
                });
            }
        }
        
        return result;
    } catch (error) {
        console.error('Error fetching approved invoices for project and category:', projectId, spendCategoryCode, error);
        return [];
    }
}

/**
 * Get approved invoices for department in the same month
 * @param departmentId - The department ID
 * @param invoiceIssueDate - The issue date of the current invoice
 * @returns Array of approved invoices
 */
export async function getApprovedInvoicesForDepartmentInMonth(departmentId: number, invoiceIssueDate: string): Promise<{invoice: OdooInvoice, amount: number}[]> {
    try {
        
        const targetDate = new Date(invoiceIssueDate);
        const year = targetDate.getFullYear();
        const month = targetDate.getMonth() + 1; // JavaScript months are 0-based
        
        const startOfMonth = `${year}-${month.toString().padStart(2, '0')}-01`;
        const endOfMonth = `${year}-${month.toString().padStart(2, '0')}-${new Date(year, month, 0).getDate()}`;

        const domain = [
            ["move_type", "=", "in_invoice"],
            ["x_studio_project_manager_review_status", "=", "approved"],
            ["state", "!=", "cancel"],
            ["invoice_date", ">=", startOfMonth],
            ["invoice_date", "<=", endOfMonth]
        ];

        const fields = [
            "id",
            "amount_untaxed",
            "invoice_date_due",
            "line_ids"
        ];

        const invoices = await odooApi.searchRead(INVOICE_MODEL, domain, { fields });
        
        const result: {invoice: OdooInvoice, amount: number}[] = [];
        
        // For each invoice, check its line items
        for (const invoice of invoices) {
            if (!invoice.line_ids || invoice.line_ids.length === 0) {
                continue;
            }
            
            // Get line items for this invoice
            const lineItems = await odooApi.searchRead(LINE_ITEM_MODEL, [
                ["id", "in", invoice.line_ids]
            ], {
                fields: ["id", "move_id", "account_id", "analytic_distribution", "price_subtotal"]
            });
            
            // Filter line items that have the department in analytic distribution
            const matchingLines = lineItems.filter((line: OdooInvoiceLineItem) => {
                if (!line.analytic_distribution) {
                    return false;
                }
                
                return Object.keys(line.analytic_distribution).includes(departmentId.toString());
            });
            
            if (matchingLines.length > 0) {
                // Calculate total amount for matching lines
                const totalAmount = matchingLines.reduce((sum, line) => sum + (line.price_subtotal || 0), 0);
                result.push({
                    invoice: invoice as OdooInvoice,
                    amount: totalAmount
                });
            }
        }
        
        return result;
    } catch (error) {
        console.error('Error fetching approved invoices for department in month:', departmentId, invoiceIssueDate, error);
        return [];
    }
}

/**
 * Calculate budget impact for construction invoice (project + spend category)
 * @param projectId - The project ID
 * @param spendCategoryCode - The spend category code
 * @param invoiceAmount - The amount of the invoice being approved
 * @param sessionApprovedAmount - Total amount already approved in this session
 * @returns Budget impact calculation
 */
export async function calculateConstructionBudgetImpact(
    projectId: number,
    spendCategoryCode: string,
    invoiceAmount: number,
    sessionApprovedAmount: number = 0
): Promise<BudgetImpact | null> {
    try {
        
        // Get budget for project
        const budget = await getBudgetForProject(projectId);
        if (!budget) {
            console.warn(`No budget found for project ${projectId}`);
            return null;
        }

        // Get budget line item for spend category
        const lineItem = await getBudgetLineItem(budget.id, spendCategoryCode);
        if (!lineItem) {
            console.warn(`No budget line item found for budget ${budget.id} and spend category ${spendCategoryCode}`);
            return null;
        }
        
        // Get the budget amount from the line item
        const plannedAmount = lineItem.amount || 0;

        // Get approved invoices for this project and spend category
        const approvedInvoiceData = await getApprovedInvoicesForProjectAndCategory(projectId, spendCategoryCode);
        const totalApprovedAmount = approvedInvoiceData.reduce((sum, data) => sum + data.amount, 0);

        const currentSpent = totalApprovedAmount + sessionApprovedAmount;
        const currentRemaining = plannedAmount - currentSpent;
        const percentageUsed = plannedAmount > 0 ? (currentSpent / plannedAmount) * 100 : 0;
        
        // Calculate projected state after this invoice
        const projectedSpent = currentSpent + invoiceAmount;
        const projectedRemaining = plannedAmount - projectedSpent;
        const projectedPercentageUsed = plannedAmount > 0 ? (projectedSpent / plannedAmount) * 100 : 0;
        
        // Determine budget status
        const isOverBudget = currentSpent > plannedAmount;
        const willBeOverBudget = projectedSpent > plannedAmount;

        return {
            budgetId: budget.id,
            projectId,
            departmentId: projectId,
            currentBudget: plannedAmount,
            currentSpent,
            currentRemaining,
            invoiceAmount,
            projectedSpent,
            projectedRemaining,
            percentageUsed,
            projectedPercentageUsed,
            isOverBudget,
            willBeOverBudget,
            currency: 'EUR',
            isMockData: false
        };
    } catch (error) {
        console.error('Error calculating construction budget impact:', error);
        return null;
    }
}

/**
 * Calculate budget impact for department invoice
 * @param departmentId - The department ID
 * @param departmentName - The department name
 * @param invoiceAmount - The amount of the invoice being approved
 * @param invoiceIssueDate - The issue date of the current invoice
 * @param sessionApprovedAmount - Total amount already approved in this session
 * @returns Budget impact calculation
 */
export async function calculateDepartmentBudgetImpact(
    departmentId: number,
    departmentName: string,
    invoiceAmount: number,
    invoiceIssueDate: string,
    sessionApprovedAmount: number = 0
): Promise<BudgetImpact | null> {
    try {
        // Get budget for department
        const budget = await getBudgetForDepartment(departmentName);
        if (!budget) {
            console.warn(`No budget found for department ${departmentName}`);
            return null;
        }

        // Get all budget line items
        const lineItems = await getAllBudgetLineItems(budget.id);
        const totalPlannedAmount = lineItems.reduce((sum, item) => sum + (item.amount || 0), 0);

        // Get approved invoices for this department in the same month
        const approvedInvoiceData = await getApprovedInvoicesForDepartmentInMonth(departmentId, invoiceIssueDate);
        const totalApprovedAmount = approvedInvoiceData.reduce((sum, data) => sum + data.amount, 0);

        const currentSpent = totalApprovedAmount + sessionApprovedAmount;
        const currentRemaining = totalPlannedAmount - currentSpent;
        const percentageUsed = totalPlannedAmount > 0 ? (currentSpent / totalPlannedAmount) * 100 : 0;
        
        // Calculate projected state after this invoice
        const projectedSpent = currentSpent + invoiceAmount;
        const projectedRemaining = totalPlannedAmount - projectedSpent;
        const projectedPercentageUsed = totalPlannedAmount > 0 ? (projectedSpent / totalPlannedAmount) * 100 : 0;
        
        // Determine budget status
        const isOverBudget = currentSpent > totalPlannedAmount;
        const willBeOverBudget = projectedSpent > totalPlannedAmount;

        return {
            budgetId: budget.id,
            projectId: departmentId,
            departmentId,
            currentBudget: totalPlannedAmount,
            currentSpent,
            currentRemaining,
            invoiceAmount,
            projectedSpent,
            projectedRemaining,
            percentageUsed,
            projectedPercentageUsed,
            isOverBudget,
            willBeOverBudget,
            currency: 'EUR',
            isMockData: false
        };
    } catch (error) {
        console.error('Error calculating department budget impact:', error);
        return null;
    }
}

/**
 * Calculate budget impact for an invoice approval (legacy function for backward compatibility)
 * @param analyticAccountId - The project or department ID
 * @param invoiceAmount - The amount of the invoice being approved
 * @param sessionApprovedAmount - Total amount already approved in this session for this account
 * @returns Budget impact calculation
 */
export async function calculateBudgetImpact(
    analyticAccountId: number, 
    invoiceAmount: number, 
    sessionApprovedAmount: number = 0
): Promise<BudgetImpact | null> {
    try {
        // This is a legacy function - use calculateConstructionBudgetImpact or calculateDepartmentBudgetImpact instead
        console.warn('calculateBudgetImpact is deprecated. Use calculateConstructionBudgetImpact or calculateDepartmentBudgetImpact instead.');
        
        // Return mock data for backward compatibility
        const mockPlannedAmount = 100000; // Mock budget
        const mockPracticalAmount = 45000; // Mock spent
        const currency = 'EUR';
        
        // Calculate current state
        const currentSpent = mockPracticalAmount + sessionApprovedAmount;
        const currentRemaining = mockPlannedAmount - currentSpent;
        const percentageUsed = mockPlannedAmount > 0 ? (currentSpent / mockPlannedAmount) * 100 : 0;
        
        // Calculate projected state after this invoice
        const projectedSpent = currentSpent + invoiceAmount;
        const projectedRemaining = mockPlannedAmount - projectedSpent;
        const projectedPercentageUsed = mockPlannedAmount > 0 ? (projectedSpent / mockPlannedAmount) * 100 : 0;
        
        // Determine budget status
        const isOverBudget = currentSpent > mockPlannedAmount;
        const willBeOverBudget = projectedSpent > mockPlannedAmount;

        return {
            budgetId: 0, // Mock ID
            projectId: analyticAccountId,
            departmentId: analyticAccountId,
            currentBudget: mockPlannedAmount,
            currentSpent,
            currentRemaining,
            invoiceAmount,
            projectedSpent,
            projectedRemaining,
            percentageUsed,
            projectedPercentageUsed,
            isOverBudget,
            willBeOverBudget,
            currency,
            isMockData: true
        };
    } catch (error) {
        console.error('Error calculating budget impact:', error);
        return null;
    }
}

/**
 * Get all budgets for a list of analytic account IDs
 * @param analyticAccountIds - Array of project/department IDs
 * @returns Array of budget data
 */
export async function getBudgetsForAnalyticAccounts(analyticAccountIds: number[]): Promise<OdooBudget[]> {
    try {
        if (analyticAccountIds.length === 0) {
            return [];
        }

        const domain = [
            ["company_id", "=", ODOO_MAIN_COMPANY_ID]
        ];

        const fields = [
            "id",
            "name",
            "display_name",
            "company_id",
            "item_ids",
            "sequence",
            "create_date",
            "create_uid",
            "write_date",
            "write_uid"
        ];

        const budgets = await odooApi.searchRead(BUDGET_MODEL, domain, { 
            fields,
            order: "create_date desc" // Get most recent budgets first
        });
        
        return budgets;
    } catch (error) {
        console.error('Error fetching budgets for analytic accounts:', analyticAccountIds, error);
        return [];
    }
}
