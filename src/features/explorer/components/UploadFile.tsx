import React from 'react';
import { useExplorerStore } from '@/stores';
import { ImportWizard } from './ImportWizard';

const UploadFile: React.FC = () => {
  const { uploadFileModalOpen, closeUploadFileModal, selectedDatabase } = useExplorerStore();

  // If we shouldn't render when closed, we can return null. 
  // But Dialog usually handles open state. 
  // ImportWizard expects isOpen prop.
  // However, removing it from DOM when closed resets state, which is good.
  if (!uploadFileModalOpen) return null;

  return (
    <ImportWizard
      isOpen={uploadFileModalOpen}
      onClose={closeUploadFileModal}
      database={selectedDatabase || 'default'}
    />
  );
}

export default UploadFile;
