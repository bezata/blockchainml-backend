export class FileValidationService {
  static MAX_FILE_SIZE = 100 * 1024 * 1024; // 100MB
  static ALLOWED_FILE_TYPES = ["csv", "json", "txt", "xlsx"];

  static validateFile(
    fileName: string,
    fileSize: number
  ): { valid: boolean; error?: string } {
    const fileExtension = fileName.split(".").pop()?.toLowerCase();

    if (!fileExtension || !this.ALLOWED_FILE_TYPES.includes(fileExtension)) {
      return {
        valid: false,
        error:
          "Invalid file type. Allowed types are: " +
          this.ALLOWED_FILE_TYPES.join(", "),
      };
    }

    if (fileSize > this.MAX_FILE_SIZE) {
      return {
        valid: false,
        error: `File size exceeds the maximum limit of ${
          this.MAX_FILE_SIZE / (1024 * 1024)
        }MB`,
      };
    }

    return { valid: true };
  }
}
