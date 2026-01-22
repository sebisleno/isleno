// /apps/kpis/src/lib/services/invoicePermissions.ts

import { supabaseServer } from '@/lib/supabaseServer';
import { odooApi } from '@/lib/odoo/api';

/**
 * Invoice permission service for Odoo-based invoice system
 * Handles permission checks for invoice access without database storage
 */
export class InvoicePermissionService {
  private async getSupabase() {
    return await supabaseServer()
  }

  /**
   * Check if user has invoice.view permission
   */
  async hasInvoiceViewPermission(userId: string): Promise<boolean> {
    try {
      const supabase = await this.getSupabase()
      
      // Check if user has admin role (admin has all permissions)
      const { data: adminRole } = await supabase
        .from('user_roles')
        .select('role')
        .eq('user_id', userId)
        .eq('role', 'admin')
        .single()
      
      if (adminRole) {
        return true
      }

      // Check other role-based permissions
      const { data: userRoles } = await supabase
        .from('user_roles')
        .select('role')
        .eq('user_id', userId)
      
      if (!userRoles || userRoles.length === 0) {
        return false
      }

      // Define role permissions for invoice access
      const rolePermissions: Record<string, string[]> = {
        'default': [], // No permissions - new users
        'external_basic': ['invoice.view'], // Can view their own invoices
        'internal': ['invoice.view'], // Can view invoices
        'internal_user': ['invoice.view'], // Can view invoices
        'department_head': ['invoice.view'], // Can view invoices
        'admin': ['invoice.view', 'invoice.create', 'invoice.edit', 'invoice.delete', 'invoice.approve'] // All invoice permissions
      }

      for (const userRole of userRoles) {
        const role = userRole.role
        if (rolePermissions[role]?.includes('invoice.view')) {
          return true
        }
      }

      return false
    } catch (error) {
      console.error('Error checking invoice permission:', error)
      return false
    }
  }

  /**
   * Get user's invoice approval alias from profile
   */
  async getUserInvoiceAlias(userId: string): Promise<string | null> {
    try {
      const supabase = await this.getSupabase()
      const { data: profile } = await supabase
        .from('profiles')
        .select('invoice_approval_alias')
        .eq('id', userId)
        .single()

      return profile?.invoice_approval_alias?.toLowerCase() || null
    } catch (error) {
      console.error('Error getting user invoice alias:', error)
      return null
    }
  }

  /**
   * Get user's department ID
   */
  async getUserDepartment(userId: string): Promise<string | null> {
    try {
      const supabase = await this.getSupabase()
      const { data: profile } = await supabase
        .from('profiles')
        .select('department_id')
        .eq('id', userId)
        .single()

      return profile?.department_id || null
    } catch (error) {
      console.error('Error getting user department:', error)
      return null
    }
  }

  /**
   * Check if user is department head
   */
  async isDepartmentHead(userId: string): Promise<boolean> {
    try {
      const supabase = await this.getSupabase()
      const { data: role } = await supabase
        .from('user_roles')
        .select('role')
        .eq('user_id', userId)
        .eq('role', 'department_head')
        .single()

      return !!role
    } catch (error) {
      console.error('Error checking department head status:', error)
      return false
    }
  }

  /**
   * Check if user is admin
   */
  async isAdmin(userId: string): Promise<boolean> {
    try {
      const supabase = await this.getSupabase()
      const { data: role } = await supabase
        .from('user_roles')
        .select('role')
        .eq('user_id', userId)
        .eq('role', 'admin')
        .single()

      return !!role
    } catch (error) {
      console.error('Error checking admin status:', error)
      return false
    }
  }

  /**
   * Get all invoice approval aliases for users in a department
   */
  async getDepartmentInvoiceAliases(departmentId: string): Promise<string[]> {
    try {
      const supabase = await this.getSupabase()
      const { data: profiles } = await supabase
        .from('profiles')
        .select('invoice_approval_alias')
        .eq('department_id', departmentId)
        .not('invoice_approval_alias', 'is', null)

      return profiles?.map(p => p.invoice_approval_alias?.toLowerCase()).filter((alias): alias is string => Boolean(alias)) || []
    } catch (error) {
      console.error('Error getting department invoice aliases:', error)
      return []
    }
  }

  /**
   * Get all invoice approval aliases for all users (admin only)
   */
  async getAllInvoiceAliases(): Promise<string[]> {
    try {
      const supabase = await this.getSupabase()
      const { data: profiles } = await supabase
        .from('profiles')
        .select('invoice_approval_alias')
        .not('invoice_approval_alias', 'is', null)

      return profiles?.map(p => p.invoice_approval_alias?.toLowerCase()).filter((alias): alias is string => Boolean(alias)) || []
    } catch (error) {
      console.error('Error getting all invoice aliases:', error)
      return []
    }
  }

  /**
   * Determine invoice access level for a user
   */
  async getInvoiceAccessLevel(userId: string): Promise<{
    canView: boolean;
    accessType: 'none' | 'individual' | 'department' | 'admin';
    aliases: string[];
  }> {
    try {
      // Check basic permission
      const canView = await this.hasInvoiceViewPermission(userId)
      if (!canView) {
        return { canView: false, accessType: 'none', aliases: [] }
      }

      // Check if admin
      const isAdmin = await this.isAdmin(userId)
      if (isAdmin) {
        const aliases = await this.getAllInvoiceAliases()
        return { canView: true, accessType: 'admin', aliases }
      }

      // Check if department head
      const isDeptHead = await this.isDepartmentHead(userId)
      if (isDeptHead) {
        const departmentId = await this.getUserDepartment(userId)
        if (departmentId) {
          const aliases = await this.getDepartmentInvoiceAliases(departmentId)
          return { canView: true, accessType: 'department', aliases }
        }
      }

      // Individual access
      const alias = await this.getUserInvoiceAlias(userId)
      return { 
        canView: true, 
        accessType: 'individual', 
        aliases: alias ? [alias] : [] 
      }
    } catch (error) {
      console.error('Error determining invoice access level:', error)
      return { canView: false, accessType: 'none', aliases: [] }
    }
  }
}

// Export singleton instance
export const invoicePermissionService = new InvoicePermissionService()
