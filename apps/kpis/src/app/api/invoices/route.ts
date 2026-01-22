import { NextRequest, NextResponse } from 'next/server';
import { getAllInvoices, getInvoiceCount } from '@/lib/odoo/services';
import { invoicePermissionService } from '@/lib/services/invoicePermissions';
import { isZeroValueInvoice } from '@/lib/utils/invoiceUtils';
import { supabaseServer } from '@/lib/supabaseServer';

export async function GET(request: NextRequest) {
  try {
    // Get current user
    const supabase = await supabaseServer();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Check invoice access level
    const { canView, accessType, aliases } = await invoicePermissionService.getInvoiceAccessLevel(user.id);

    if (!canView) {
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 });
    }

    // Extract pagination parameters
    const { searchParams } = new URL(request.url);
    const page = parseInt(searchParams.get('page') || '1', 10);
    const limit = parseInt(searchParams.get('limit') || '20', 10);
    const offset = (page - 1) * limit;

    // Get invoices based on access level
    let result;
    let totalCount = 0;
    
    if (accessType === 'admin') {
      // Admin: get all invoices (no filtering)
      totalCount = await getInvoiceCount(undefined);
      result = await getAllInvoices(undefined, false, limit, offset);
      
      // Add department information for admin view
      const invoices = Array.isArray(result) ? result : result.invoices;
      const invoicesWithDepartment = await Promise.all(
        invoices.map(async (invoice) => {
          if (invoice.x_studio_project_manager_1) {
            // Get department for this invoice's approval alias
            const { data: profile } = await supabase
              .from('profiles')
              .select('department_id')
              .ilike('invoice_approval_alias', invoice.x_studio_project_manager_1)
              .single();

            if (profile?.department_id) {
              const { data: department } = await supabase
                .from('departments')
                .select('department_name')
                .eq('department_id', profile.department_id)
                .single();

              return {
                ...invoice,
                department_name: department?.department_name || 'Unknown Department'
              };
            }
          }
          return {
            ...invoice,
            department_name: 'No Department'
          };
        })
      );
      
      result = Array.isArray(result) ? invoicesWithDepartment : { ...result, invoices: invoicesWithDepartment };
    } else if (accessType === 'department') {
      // Department head: get invoices from all users in their department
      // For department heads, we need to get all invoices first, then paginate client-side
      // This is not ideal but necessary due to Odoo's limitation with multiple aliases
      const allInvoices = [];
      for (const alias of aliases) {
        const aliasInvoices = await getAllInvoices(alias);
        const invoices = Array.isArray(aliasInvoices) ? aliasInvoices : aliasInvoices.invoices;
        allInvoices.push(...invoices);
      }
      
      // Calculate total count
      totalCount = allInvoices.length;
      
      // Apply pagination manually
      const paginatedInvoices = allInvoices.slice(offset, offset + limit);
      
      // Get department information for department head view
      const userDepartmentId = await invoicePermissionService.getUserDepartment(user.id);
      let department = null;
      if (userDepartmentId) {
        const { data: deptData } = await supabase
          .from('departments')
          .select('department_name')
          .eq('department_id', userDepartmentId)
          .single();
        department = deptData;
      }
      
      // Add department information for department head view
      const invoicesWithDepartment = paginatedInvoices.map(invoice => ({
        ...invoice,
        department_name: department?.department_name || 'Unknown Department'
      }));
      
      result = { 
        invoices: invoicesWithDepartment, 
        ocrRefreshPerformed: false, 
        zeroValueInvoicesRefreshed: 0, 
        zeroValueInvoiceIds: [] 
      };
    } else {
      // Individual: get invoices for user's alias only
      totalCount = await getInvoiceCount(aliases[0] || undefined);
      result = await getAllInvoices(aliases[0] || undefined, false, limit, offset);
    }
    
    // Helper function to extract data from result (handles both old and new formats)
    const extractResultData = (result: any) => {
      if (Array.isArray(result)) {
        return {
          invoices: result,
          ocrRefreshPerformed: false,
          zeroValueInvoicesRefreshed: 0,
          zeroValueInvoiceIds: []
        };
      }
      
      return {
        invoices: result.invoices,
        ocrRefreshPerformed: result.ocrRefreshPerformed ?? false,
        zeroValueInvoicesRefreshed: result.zeroValueInvoicesRefreshed ?? 0,
        zeroValueInvoiceIds: result.zeroValueInvoiceIds ?? []
      };
    };

    const { invoices, ocrRefreshPerformed, zeroValueInvoicesRefreshed, zeroValueInvoiceIds } = extractResultData(result);
    
    // Count zero-value invoices after refresh
    const zeroValueCount = invoices.filter(isZeroValueInvoice).length;
    
    // Calculate pagination metadata
    const totalPages = Math.ceil(totalCount / limit);
    const hasNextPage = page < totalPages;
    const hasPrevPage = page > 1;
    
    return NextResponse.json({
      invoices,
      metadata: {
        totalInvoices: invoices.length,
        zeroValueInvoicesAfterRefresh: zeroValueCount,
        zeroValueInvoicesRefreshed,
        ocrRefreshPerformed,
        zeroValueInvoiceIds
      },
      pagination: {
        page,
        limit,
        totalCount,
        totalPages,
        hasNextPage,
        hasPrevPage
      }
    });
  } catch (error: any) {
    console.error("Failed to fetch invoices:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
} 