inotifywait -m -e close_write --format "%w%f" ./ | while read -r file; do
  whisper "$file" --model base --output_format txt --language en --output_dir ../transcripts 
#   && rm "$file";
done