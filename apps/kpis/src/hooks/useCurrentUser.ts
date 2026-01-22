import { useSession } from '@/components/providers/SessionProvider'
import { useState, useEffect } from 'react'
import { supabaseClient } from '@/lib/supabaseClient'
import type {
  UserProfile,
  UserRoleType,
  UserPermissions,
  EnhancedUser
} from '@isleno/types/auth'

export interface UserRole {
  id: string
  role: string
  user_id: string
}

export function useCurrentUser(): EnhancedUser {
  const { user, session, loading: sessionLoading, signOut } = useSession()
  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [role, setRole] = useState<UserRoleType>('default')
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    const fetchUserData = async () => {
      if (!user?.id) {
        setProfile(null)
        setRole('default')
        setIsLoading(false)
        return
      }

      try {
        const supabase = supabaseClient

        // Fetch user profile with department info
        const { data: profileData, error: profileError } = await supabase
          .from('profiles')
          .select(`
            *,
            department_id (
              department_id,
              department_name,
              key,
              odoo_group_id
            )
          `)
          .eq('id', user.id)
          .single()

        if (profileError) {
          console.error('Error fetching profile:', profileError)
        }

        // Fetch user roles
        const { data: roleData, error: roleError } = await supabase
          .from('user_roles')
          .select('role')
          .eq('user_id', user.id)

        if (roleError) {
          console.error('Error fetching roles:', roleError)
        }

        // Process profile data
        const userProfile: UserProfile | null = profileData ? {
          id: profileData.id,
          full_name: profileData.full_name,
          department_id: profileData.department_id,
          department_name: profileData.department_id?.department_name || null,
          department_key: profileData.department_id?.key || null,
          odoo_group_id: profileData.department_id?.odoo_group_id || null,
          job_title: profileData.job_title,
          language: profileData.language,
          location: profileData.location,
          monday_user_id: profileData.monday_user_id,
          invoice_approval_alias: profileData.invoice_approval_alias?.toLowerCase() ?? ""
        } : null

        // Process role data - use the highest priority role if multiple exist
        const getHighestPriorityRole = (roles: Array<{ role: string }>): UserRoleType => {
          const rolePriority: Record<string, number> = {
            'admin': 5,
            'department_head': 4,
            'team_leader': 3,
            'internal': 2,
            'internal_user': 2,
            'external_basic': 1,
            'default': 0
          }
          
          let highestRole: UserRoleType = 'default'
          let highestPriority = -1
          
          roles.forEach(({ role }) => {
            const priority = rolePriority[role] || 0
            if (priority > highestPriority) {
              highestPriority = priority
              highestRole = role as UserRoleType
            }
          })
          
          return highestRole
        }
        
        const userRole: UserRoleType = roleData && roleData.length > 0 
          ? getHighestPriorityRole(roleData)
          : 'default'

        setProfile(userProfile)
        setRole(userRole)
      } catch (error) {
        console.error('Error fetching user data:', error)
        setProfile(null)
        setRole('default')
      } finally {
        setIsLoading(false)
      }
    }

    if (!sessionLoading) {
      fetchUserData()
    }
  }, [user?.id, sessionLoading])

  // Calculate permissions based on role and profile
  const permissions: UserPermissions = {
    canAccessKpis: role === 'admin' || role === 'internal' || role === 'team_leader',
    canAccessDepartment: (departmentId: string) => {
      if (role === 'admin') return true
      if (role === 'internal' || role === 'team_leader') {
        return profile?.department_id === departmentId
      }
      return false
    },
    canAccessCalendar: role === 'admin' || role === 'team_leader' || 
      (role === 'internal' && profile?.department_key === 'Finance'),
    canAccessGantt: role === 'admin' || role === 'team_leader' || 
      (role === 'internal' && profile?.department_key === 'Finance'),
    canAccessCashflow: role === 'admin' || role === 'team_leader' || 
      (role === 'internal' && profile?.department_key === 'Finance'),
    canAccessInvoices: role === 'admin' || role === 'external_basic',
    canAccessCharts: role === 'admin',
    canAccessBoards: role === 'admin',
    canAccessAllDepartments: role === 'admin'
  }

  return {
    user,
    session,
    profile,
    role,
    permissions,
    isLoading: sessionLoading || isLoading,
    signOut,
    isAuthenticated: !!user
  }
} 