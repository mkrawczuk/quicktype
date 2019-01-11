import .TopLevel;

int main (int argc, array(string) argv) {
  Stdio.File f = Stdio.File(argv[1], "r");

  TopLevel tl = TopLevel();
  tl.decode_json(f.read());
  string to_json = Standards.JSON.encode(tl, Standards.JSON.HUMAN_READABLE);

  write(to_json);

  return 0;
}