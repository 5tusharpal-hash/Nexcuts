export interface Permission {
  key: string;
  description: string | null;
}

export interface Role {
  id: string;
  organization_id: string;
  key: string;
  name: string;
}

export interface UserRoleAssignment {
  membership_id: string;
  role_id: string;
  salon_id: string;
  assigned_at: Date;
}

export interface UserPermissions {
  permissions: string[];
  roles: string[];
}
