/* Keep file pickers usable even when the optional 3D module is still loading. */
(function () {
  function openPicker(selector) {
    var input = document.querySelector(selector);
    if (input) input.click();
  }

  document.addEventListener('click', function (event) {
    var target = event.target.closest && event.target.closest('#emptyImportBtn, #importModelBtn, #importTextureBtn, #importMotionBtn');
    if (!target) return;
    if (target.id === 'importMotionBtn') openPicker('#motionInput');
    else if (target.id === 'importTextureBtn') openPicker('#textureFolderInput');
    else openPicker('#modelFileInput');
  });

  window.mmdStagePickerHandled = true;
}());
