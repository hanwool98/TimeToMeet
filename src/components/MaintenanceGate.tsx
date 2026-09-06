import { type ReactNode, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import MaintenancePage from '../pages/MaintenancePage';
import {
  enableMaintenanceBypass,
  hasMaintenanceBypass,
  isMaintenanceActive,
} from '../services/maintenance';

type MaintenanceGateProps = {
  children: ReactNode;
};

export default function MaintenanceGate({ children }: MaintenanceGateProps) {
  const navigate = useNavigate();
  const [isBypassed, setIsBypassed] = useState(hasMaintenanceBypass);

  const handleBypass = () => {
    enableMaintenanceBypass();
    setIsBypassed(true);
    navigate('/', { replace: true });
  };

  if (isMaintenanceActive && !isBypassed) {
    return <MaintenancePage onBypass={handleBypass} />;
  }

  return children;
}
