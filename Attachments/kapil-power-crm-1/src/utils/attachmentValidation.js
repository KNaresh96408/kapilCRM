export const validateAttachment = (file) => {
  const allowedTypes = ['application/pdf', 'image/jpeg', 'image/png', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'];
  const maxSize = 5 * 1024 * 1024; // 5 MB

  if (!allowedTypes.includes(file.type)) {
    return { valid: false, message: 'Invalid file type. Allowed types are: PDF, JPEG, PNG, DOC, DOCX.' };
  }

  if (file.size > maxSize) {
    return { valid: false, message: 'File size exceeds the maximum limit of 5 MB.' };
  }

  return { valid: true, message: 'File is valid.' };
};

export const validateKpiFolderName = (name) => {
  const regex = /^[a-zA-Z0-9-_ ]+$/; // Allow alphanumeric, hyphens, underscores, and spaces
  if (!name || name.length < 3 || name.length > 50) {
    return { valid: false, message: 'Folder name must be between 3 and 50 characters long.' };
  }

  if (!regex.test(name)) {
    return { valid: false, message: 'Folder name contains invalid characters. Only alphanumeric, hyphens, underscores, and spaces are allowed.' };
  }

  return { valid: true, message: 'Folder name is valid.' };
};