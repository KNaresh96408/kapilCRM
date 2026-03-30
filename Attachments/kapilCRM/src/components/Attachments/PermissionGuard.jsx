import React, { useContext } from 'react';
import { AuthContext } from '../../context/AuthContext';

const PermissionGuard = ({ children, requiredPermission }) => {
  const { user } = useContext(AuthContext);

  const hasPermission = () => {
    if (!user) return false;
    // Assuming user.permissions is an array of permissions
    return user.permissions.includes(requiredPermission);
  };

  if (!hasPermission()) {
    return <div>You do not have permission to access this resource.</div>;
  }

  return <>{children}</>;
};

export default PermissionGuard;