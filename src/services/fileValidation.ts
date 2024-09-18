export class FileValidationService {
  static MAX_FILE_SIZE = 5 * 1024 * 1024 * 1024; // 5GB
  static ALLOWED_FILE_TYPES = [
    "text/csv",
    "application/json",
    "text/plain",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/vnd.ms-excel",
    "application/x-parquet",
  ];

  static validateFile(
    fileName: string,
    fileSize: number,
    contentType: string
  ): { valid: boolean; error?: string } {
    if (!this.ALLOWED_FILE_TYPES.includes(contentType)) {
      return {
        valid: false,
        error:
          "Invalid file type. Allowed types are: CSV, JSON, TXT, XLSX, XLS, and Parquet.",
      };
    }

    if (fileSize > this.MAX_FILE_SIZE) {
      return {
        valid: false,
        error: `File size exceeds the maximum limit of ${
          this.MAX_FILE_SIZE / (1024 * 1024 * 1024)
        }GB`,
      };
    }

    return { valid: true };
  }
}