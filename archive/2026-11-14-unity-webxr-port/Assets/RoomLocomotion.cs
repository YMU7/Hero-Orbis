using UnityEngine;
using UnityEngine.InputSystem;

[RequireComponent(typeof(CharacterController))]
public class RoomLocomotion : MonoBehaviour
{
    InputAction move;
    InputAction turn;
    bool turned;
    void OnEnable()
    {
        move = new InputAction("Move", InputActionType.Value, "<XRController>{LeftHand}/primary2DAxis");
        turn = new InputAction("Turn", InputActionType.Value, "<XRController>{RightHand}/primary2DAxis");
        move.Enable(); turn.Enable();
    }
    void Update()
    {
        var head = Camera.main;
        if (!head) return;
        var controller = GetComponent<CharacterController>();
        float height = Mathf.Clamp(head.transform.position.y - transform.position.y, 1, 2.2f);
        var localHead = transform.InverseTransformPoint(head.transform.position);
        controller.height = height;
        controller.center = new Vector3(localHead.x, height / 2, localHead.z);
        var forward = Vector3.ProjectOnPlane(head.transform.forward, Vector3.up).normalized;
        var right = Vector3.Cross(Vector3.up, forward);
        var stick = move.ReadValue<Vector2>();
        controller.Move(((forward * stick.y + right * stick.x) * 2f + Vector3.down * 2f) * Time.deltaTime);
        float rotation = turn.ReadValue<Vector2>().x;
        if (Mathf.Abs(rotation) < 0.3f) turned = false;
        if (!turned && Mathf.Abs(rotation) > 0.7f)
        {
            transform.RotateAround(head.transform.position, Vector3.up, Mathf.Sign(rotation) * 30);
            turned = true;
        }
    }
    void OnDisable()
    {
        move?.Dispose(); turn?.Dispose();
    }
}
