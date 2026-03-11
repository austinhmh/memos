class Document {
  id = "";
  title = "";
  text = "";
  emoji = "";
  url = "";
  urlId = "";
  createdAt = new Date();
  updatedAt = new Date();
  publishedAt: Date | null = null;
  template = false;
  fullWidth = false;
  insightsEnabled = false;
  collectionId = "";

  get isPersistedOnce() {
    return !!this.id;
  }

  getSummary() {
    return this.text.slice(0, 200);
  }
}

export default Document;
