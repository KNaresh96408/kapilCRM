export interface Attachment {
  id: string;
  name: string;
  type: string;
  createdBy: string;
  createdAt: Date;
  folderId: string;
  size: number;
}

export interface Folder {
  id: string;
  name: string;
  parentId: string | null;
  createdBy: string;
  createdAt: Date;
}

export interface UserPermission {
  userId: string;
  canView: boolean;
  canUpload: boolean;
  canDelete: boolean;
}